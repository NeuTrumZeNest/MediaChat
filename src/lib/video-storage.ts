import { mkdir, open, readFile, lstat, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { InputError } from "./request-body.ts";
import { MAX_VIDEO_SIZE, validateVideoSelection, type VideoExtension, type VideoInfo } from "./video-types.ts";
import { runMediaProcess } from "./media-process.ts";

export const VIDEO_DIR = join(process.cwd(), "uploads", "videos");
export const VIDEO_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(mp4|webm)$/;
type StoredVideo = VideoInfo & { id: string; filename: string; extension: VideoExtension; ownerId: number; uploadedAt: string };
type Probe = { streams?: { codec_type?: string; codec_name?: string; pix_fmt?: string; width?: number; height?: number; side_data_list?: { rotation?: number }[] }[]; format?: { format_name?: string; duration?: string } };

export function videoProbeInfo(probe: Probe, extension: VideoExtension): Pick<VideoInfo, "duration" | "width" | "height" | "videoCodec" | "audioCodec"> {
  const videos = probe.streams?.filter((stream) => stream.codec_type === "video") || [];
  const audios = probe.streams?.filter((stream) => stream.codec_type === "audio") || [];
  const video = videos[0];
  const declaredDuration = Number(probe.format?.duration);
  // WebM от MediaRecorder часто не имеет поля duration; уточним при полном декодировании.
  const duration = Number.isFinite(declaredDuration) ? declaredDuration : 0;
  if (videos.length !== 1 || audios.length > 1 || !video?.width || !video.height ||
      video.width > 4096 || video.height > 4096 || video.width * video.height > 8_847_360 ||
      duration < 0 || (Number.isFinite(declaredDuration) && duration === 0) || duration > 1800) {
    throw new InputError("Поддерживается одно видео до 30 минут и до 4K с одной звуковой дорожкой", 415);
  }
  const codec = video.codec_name;
  const audio = audios[0]?.codec_name || null;
  const correctContainer = extension === "mp4" ? probe.format?.format_name?.includes("mp4") : probe.format?.format_name?.includes("webm");
  if (!correctContainer || video.pix_fmt !== "yuv420p" ||
      (extension === "mp4" ? codec !== "h264" || (audio && audio !== "aac") :
        !["vp8", "vp9"].includes(codec || "") || (audio && !["opus", "vorbis"].includes(audio)))) {
    throw new InputError("Неподдерживаемый кодек. Используйте MP4 с H.264/AAC или WebM с VP8/VP9 и Opus/Vorbis, 8-bit YUV 4:2:0.", 415);
  }
  const rotation = video.side_data_list?.find((item) => typeof item.rotation === "number")?.rotation || 0;
  const rotated = Math.abs(rotation % 180) === 90;
  return { duration, width: rotated ? video.height : video.width, height: rotated ? video.width : video.height,
    videoCodec: codec as VideoInfo["videoCodec"], audioCodec: audio as VideoInfo["audioCodec"] };
}

export function matchesVideoSignature(header: Buffer, extension: VideoExtension) {
  if (extension === "mp4") {
    if (header.length < 16 || header.toString("ascii", 4, 8) !== "ftyp") return false;
    const boxSize = header.readUInt32BE(0);
    if (boxSize < 16 || boxSize > header.length || boxSize % 4 !== 0) return false;
    const brands = [header.toString("ascii", 8, 12)];
    for (let offset = 16; offset < boxSize; offset += 4) brands.push(header.toString("ascii", offset, offset + 4));
    return brands.some((brand) => /^(isom|iso[2-9]|mp4[12]|avc1|M4V )$/.test(brand));
  }
  if (header.length < 8 || header.readUInt32BE(0) !== 0x1a45dfa3) return false;
  // WebM — EBML с DocType=webm, а не Matroska с переименованным расширением.
  function vint(offset: number) {
    const first = header[offset];
    if (!first) return null;
    let length = 1;
    while (length <= 8 && !(first & (1 << (8 - length)))) length++;
    if (length > 8 || offset + length > header.length) return null;
    let value = first & ((1 << (8 - length)) - 1);
    for (let i = 1; i < length; i++) value = value * 256 + header[offset + i];
    return Number.isSafeInteger(value) ? { length, value } : null;
  }
  const outer = vint(4);
  if (!outer || 4 + outer.length + outer.value > header.length) return false;
  const end = 4 + outer.length + outer.value;
  let position = 4 + outer.length;
  while (position < end) {
    const first = header[position];
    let idLength = 1;
    while (idLength <= 4 && !(first & (1 << (8 - idLength)))) idLength++;
    if (idLength > 4) return false;
    const isDocType = idLength === 2 && header[position] === 0x42 && header[position + 1] === 0x82;
    position += idLength;
    const size = vint(position);
    if (!size || position + size.length + size.value > end) return false;
    position += size.length;
    if (isDocType) return header.toString("ascii", position, position + size.value) === "webm";
    position += size.value;
  }
  return false;
}

async function streamOriginal(request: Request, filePath: string) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_VIDEO_SIZE)) throw new InputError("Максимальный размер видео — 50 МБ", 413);
  if (!request.body) throw new InputError("Выберите видео");
  const file = await open(filePath, "wx");
  const reader = request.body.getReader();
  let size = 0;
  try {
    for (;;) {
      if (request.signal.aborted) throw new InputError("Загрузка отменена", 408);
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_VIDEO_SIZE) { await reader.cancel(); throw new InputError("Максимальный размер видео — 50 МБ", 413); }
      // FileHandle.write может записать меньше переданного chunk.
      let offset = 0;
      while (offset < value.byteLength) {
        const { bytesWritten } = await file.write(value, offset, value.byteLength - offset);
        if (!bytesWritten) throw new Error("Не удалось записать видео");
        offset += bytesWritten;
      }
    }
    if (!size) throw new InputError("Нельзя отправить пустое видео");
    return size;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); await file.close(); }
}

export async function saveVideo(request: Request, originalName: string, ownerId: number) {
  let extension: VideoExtension;
  try { extension = validateVideoSelection(originalName, (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()); }
  catch (error) { throw new InputError((error as Error).message, 415); }
  const id = randomUUID();
  const filename = `${id}.${extension}`;
  const staging = join(VIDEO_DIR, "staging");
  await Promise.all([mkdir(staging, { recursive: true }), mkdir(join(VIDEO_DIR, "metadata"), { recursive: true }), mkdir(join(VIDEO_DIR, "posters"), { recursive: true })]);
  const temporary = join(staging, filename);
  const posterTemporary = join(staging, `${id}.jpg`);
  const metadataTemporary = join(staging, `${id}.json`);
  const target = join(VIDEO_DIR, filename);
  const posterTarget = join(VIDEO_DIR, "posters", `${id}.jpg`);
  let moved = false;
  let posterMoved = false;
  try {
    const size = await streamOriginal(request, temporary);
    const handle = await open(temporary, "r");
    const header = Buffer.alloc(Math.min(size, 65536));
    try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
    if (!matchesVideoSignature(header, extension)) throw new InputError("Содержимое файла не соответствует MP4/WebM или файл повреждён", 415);
    const input = ["-protocol_whitelist", "file", "-max_alloc", "67108864", "-threads", "2", "-f", extension === "mp4" ? "mov" : "matroska"];
    const probeOutput = await runMediaProcess(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", ...input, "-show_streams", "-show_format", "-of", "json", temporary], request.signal, 15_000);
    let probe: Probe;
    try { probe = JSON.parse(probeOutput); } catch { throw new InputError("Не удалось прочитать метаданные видео", 415); }
    const info = videoProbeInfo(probe, extension);
    const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
    // Проверяем декодирование всего файла, а не только заголовок или первый кадр.
    const progress = await runMediaProcess(ffmpeg, ["-nostdin", "-v", "error", "-xerror", "-progress", "pipe:1", "-nostats", "-err_detect", "explode", ...input, "-i", temporary,
      "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-f", "null", "-"], request.signal);
    const decodedDuration = Math.max(0, ...[...progress.matchAll(/^out_time_us=(\d+)$/gm)].map((match) => Number(match[1]) / 1_000_000));
    if (Math.max(info.duration, decodedDuration) > 1800 || (info.duration <= 0 && decodedDuration <= 0)) {
      throw new InputError("Не удалось определить длительность или видео длиннее 30 минут", 415);
    }
    if (!info.duration) info.duration = decodedDuration;
    await runMediaProcess(ffmpeg, ["-nostdin", "-v", "error", ...input, "-ss", "0", "-i", temporary,
      "-map", "0:v:0", "-an", "-sn", "-dn", "-frames:v", "1", "-filter_threads", "1", "-vf", "scale=640:360:force_original_aspect_ratio=decrease", "-q:v", "3", posterTemporary], request.signal, 20_000);
    if (request.signal.aborted) throw new InputError("Загрузка отменена", 408);
    const metadata: StoredVideo = { id, filename, extension, ownerId, uploadedAt: new Date().toISOString(), originalName, size,
      mimeType: `video/${extension}`, url: `/api/videos/${filename}`, posterUrl: `/api/videos/${filename}/poster`, ...info };
    await rename(temporary, target); moved = true;
    await rename(posterTemporary, posterTarget); posterMoved = true;
    await writeFile(metadataTemporary, JSON.stringify(metadata), { flag: "wx" });
    await rename(metadataTemporary, join(VIDEO_DIR, "metadata", `${id}.json`));
    return publicVideoInfo(metadata);
  } catch (error) {
    if (moved) await rm(target, { force: true });
    if (posterMoved) await rm(posterTarget, { force: true });
    throw error;
  } finally {
    await Promise.all([rm(temporary, { force: true }), rm(posterTemporary, { force: true }), rm(metadataTemporary, { force: true })]);
  }
}

function publicVideoInfo(data: StoredVideo): VideoInfo {
  return { url: data.url, posterUrl: data.posterUrl, originalName: data.originalName, size: data.size, mimeType: data.mimeType,
    duration: data.duration, width: data.width, height: data.height, videoCodec: data.videoCodec, audioCodec: data.audioCodec };
}

export async function readVideo(filename: string): Promise<StoredVideo | null> {
  const match = VIDEO_PATTERN.exec(filename);
  if (!match) return null;
  try {
    const data = JSON.parse(await readFile(join(VIDEO_DIR, "metadata", `${match[1]}.json`), "utf8"));
    if (!data || data.id !== match[1] || data.filename !== filename || data.extension !== match[2] ||
        !Number.isSafeInteger(data.ownerId) || data.ownerId <= 0 || typeof data.originalName !== "string" ||
        !Number.isSafeInteger(data.size) || data.size <= 0 || data.size > MAX_VIDEO_SIZE || data.mimeType !== `video/${match[2]}` ||
        data.url !== `/api/videos/${filename}` || data.posterUrl !== `/api/videos/${filename}/poster` ||
        !Number.isFinite(data.duration) || data.duration <= 0 || !Number.isInteger(data.width) || !Number.isInteger(data.height) || data.width <= 0 || data.height <= 0) return null;
    const file = await lstat(join(VIDEO_DIR, filename));
    if (!file.isFile() || file.size !== data.size) return null;
    return data as StoredVideo;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function getVideoInfo(url: string | null): Promise<VideoInfo | null> {
  if (!url?.startsWith("/api/videos/")) return null;
  const data = await readVideo(url.slice("/api/videos/".length));
  return data ? publicVideoInfo(data) : null;
}

export async function assertOwnedVideo(url: string, userId: number) {
  if (!url.startsWith("/api/videos/")) throw new Error("Некорректный адрес видео");
  const video = await readVideo(url.slice("/api/videos/".length));
  if (!video || video.ownerId !== userId) throw new Error("Видео не принадлежит вам");
}
