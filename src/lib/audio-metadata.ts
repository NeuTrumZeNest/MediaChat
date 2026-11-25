import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Имена сохраняются загрузчиком рядом с файлом, включая старые загрузки.
export async function getAudioOriginalName(audioUrl: string | null): Promise<string | null> {
  const match = audioUrl?.match(/^\/api\/audio\/([0-9a-f-]{36})\.(mp3|wav|flac)$/);
  if (!match) return null;
  try {
    const metadata = JSON.parse(await readFile(
      join(process.cwd(), "uploads", "audio", "metadata", `${match[1]}.json`), "utf8"
    ));
    return metadata.filename === `${match[1]}.${match[2]}` && typeof metadata.originalName === "string"
      ? metadata.originalName : null;
  } catch {
    return null;
  }
}
