export const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
export const VIDEO_ACCEPT = ".mp4,.webm,video/mp4,video/webm";
export type VideoExtension = "mp4" | "webm";
export type VideoInfo = {
  url: string;
  posterUrl: string;
  originalName: string;
  size: number;
  mimeType: "video/mp4" | "video/webm";
  duration: number;
  width: number;
  height: number;
  videoCodec: "h264" | "vp8" | "vp9";
  audioCodec: "aac" | "opus" | "vorbis" | null;
};

export function validateVideoSelection(name: string, mimeType: string, size?: number): VideoExtension {
  if (!name || name !== name.trim() || new TextEncoder().encode(name).length > 240 ||
      /[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(name) || name.startsWith(".")) {
    throw new Error("Некорректное имя видеофайла");
  }
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension !== "mp4" && extension !== "webm") throw new Error("Выберите видео MP4 или WebM");
  // Браузер может не определить MIME; в этом случае проверяем содержимое на сервере.
  if (mimeType && mimeType !== `video/${extension}`) throw new Error("Тип файла не соответствует расширению MP4/WebM");
  if (size !== undefined && (size <= 0 || size > MAX_VIDEO_SIZE)) throw new Error("Размер видео должен быть от 1 байта до 50 МБ");
  return extension;
}
