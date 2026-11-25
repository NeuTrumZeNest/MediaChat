import { MAX_IMAGE_SIZE } from "./image-types.ts";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export async function assertOwnedMedia(url: string, userId: number, kind: "image" | "audio") {
  const pattern = kind === "image"
    ? new RegExp(`^/api/images/(${UUID})\\.(png|jpg|webp|gif)$`)
    : new RegExp(`^/api/audio/(${UUID})\\.(mp3|wav|flac)$`);
  const match = pattern.exec(url);
  if (!match) throw new Error("Недопустимый адрес вложения");
  const filename = `${match[1]}.${match[2]}`;
  const directory = kind === "image" ? join(process.cwd(), "uploads") : join(process.cwd(), "uploads", "audio");
  const metadata = JSON.parse(await readFile(join(directory, "metadata", `${match[1]}.json`), "utf8"));
  if (metadata.id !== match[1] || metadata.ownerId !== userId || metadata.extension !== match[2] ||
      (kind === "audio" && metadata.filename !== filename)) {
    throw new Error("Можно прикреплять только собственные загруженные файлы");
  }
  const file = await stat(join(directory, filename));
  const max = kind === "image" ? MAX_IMAGE_SIZE : 50 * 1024 * 1024;
  if (!file.isFile() || file.size <= 0 || file.size > max || file.size !== metadata.size) {
    throw new Error("Файл недоступен или повреждён");
  }
}
