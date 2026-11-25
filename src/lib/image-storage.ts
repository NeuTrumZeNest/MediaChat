import { canReadAttachment } from './attachment-access.ts';
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { db } from "../prisma/db";

export const UPLOAD_DIR = join(process.cwd(), "uploads");
export const PREVIEW_DIR = join(UPLOAD_DIR, "previews");
export const META_DIR = join(UPLOAD_DIR, "metadata");

const IMAGE_NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(png|jpg|webp|gif)$/i;

const PREVIEW_NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.webp$/i;

export type ImageExtension = "png" | "jpg" | "webp" | "gif";

export interface ImageMetadata {
    id: string;
    originalName: string;
    extension: ImageExtension;
    mimeType: string;
    size: number;
    ownerId: number;
    previewAvailable: boolean;
    UploadedAt: string;
}

export function parseImageFilename(filename: string) {
    const result = IMAGE_NAME.exec(filename);

    if(!result) return null;

    return {
        id: result[1].toLowerCase(),
        extension: result[2].toLowerCase() as ImageExtension,
    };
}

export function parsePreviewFilename(filename: string) {
    const result = PREVIEW_NAME.exec(filename);
    return result ? result[1].toLowerCase() : null;
}

export function imageMimeType(ext: ImageExtension) {
    return ({
        jpg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
    } as const)[ext];
}

export function safeOriginalName(
    name: string,
    ext: ImageExtension
) {
    return (
        name
        .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
        .trim()
        .slice(0, 180) || `image.${ext}`
    );
}

export async function getImageMetadata(
    id: string
): Promise<ImageMetadata | null> {
    try {
        const raw = await readFile(
            join(META_DIR, `${id}.json`),
            "utf8"
        );

        const value: unknown = JSON.parse(raw);

        if (!value || typeof value !== "object") {
            return null;
        }

        const item = value as Partial<ImageMetadata>;

        if (
            item.id !== id ||
            !["jpg", "png", "webp", "gif"].includes(
                item.extension ?? ""
            )
        ) {
            return null;
        }

        if (
            typeof item.ownerId !== "number" ||
            typeof item.originalName !== "string"
        ) {
            return null;
        }

        return item as ImageMetadata;
    } catch (error) {
        if (
            (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
            return null;
        }

        throw error;
    }
}

type AuthResult = 
 | { ok: true; userId: number }
 | { ok: false; response: NextResponse };

 export async function authorizeImageRequest( 
    request: NextRequest 
 ): Promise<AuthResult> {
    const secret = process.env.SESSION_SECRET;

    if (!secret) {
        return {
            ok: false,
            response: NextResponse.json(
                { error: "Ошибка конфигурации" },
                { status: 500 }
            ),
        };
    }

    const token =
        request.cookies.get("mediachat_session")?.value;
    if (!token) {
        return {
            ok: false,
            response: NextResponse.json(
                { error: "Требуется вход" },
                { status: 401 }
            ),
        };
    }

    let userId: number;

    try {
        const { payload } = await jwtVerify(
            token,
            new TextEncoder().encode(secret),
            { algorithms: ["HS256"] }
        );

        userId = Number(payload.userId);
        
        if (!Number.isInteger(userId) || userId <= 0) {
            throw new Error("Invalid userId");
        }
    } catch {
        return {
            ok: false,
            response: NextResponse.json(
                { error: "Недействительная сессия" },
                { status: 401 }
            ),
        };
    }

    try {
        const user = await db.orm.public.User
            .where({ id: userId })
            .first();
        
        if (!user) {
            return {
                ok: false,
                response: NextResponse.json(
                    { error: "Пользователь не найден" },
                    { status: 401 }
                ),
            };
        }

        return { ok: true, userId };
    }   catch (error) {
        console.error("Ошибка проверки пользователя:", error);

        return {
      ok: false,
      response: NextResponse.json(
        { error: "Ошибка сервера" },
        { status: 500 }
      ),
    };
  }
}

export async function canReadImage(
    filename: string,
    userId: number
): Promise<boolean> {
    const parsed = parseImageFilename(filename);

    if (!parsed) return false;

    const metadata = await getImageMetadata(parsed.id);

    if (
    metadata &&
    metadata.extension !== parsed.extension
  ) {
    return false;
  }

  return canReadAttachment(`/api/images/${filename}`, metadata?.ownerId, userId);
}

export function  binaryResponse(
    bytes: Buffer,
    contentType: string,
    extraHeaders: Record<string, string> = {}
) {
    return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

export function isMissingFile(error: unknown) {
    return (
        (error as NodeJS.ErrnoException)?.code === "ENOENT"
    );
}


export async function cachedImageResponse(
  request: NextRequest,
  filePath: string,
  contentType: string
): Promise<Response> {
  const fileInfo = await stat(filePath);

  const etag =
    `W/"${fileInfo.size.toString(16)}-` +
    `${Math.trunc(fileInfo.mtimeMs).toString(16)}"`;

  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "private, no-cache",
    "ETag": etag,
    "Vary": "Cookie",
    "X-Content-Type-Options": "nosniff",
  });

  const ifNoneMatch =
    request.headers.get("if-none-match");

  const unchanged = ifNoneMatch
    ?.split(",")
    .some((value) => value.trim() === etag);

  if (unchanged) {
    return new Response(null, {
      status: 304,
      headers,
    });
  }

  const bytes = await readFile(filePath);

  headers.set(
    "Content-Length",
    String(bytes.byteLength)
  );

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers,
  });
}
