import { UploadHttpError } from "./upload-error.ts";
export function uploadVideo(file: File, onProgress: (percent: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/videos/upload?name=${encodeURIComponent(file.name)}`);
    request.setRequestHeader("Content-Type", file.type || (file.name.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4"));
    request.responseType = "json";
    request.timeout = 180_000;
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    request.onload = () => {
      if (request.status === 201 && request.response?.videoUrl) resolve(request.response.videoUrl);
      else reject(new UploadHttpError(request.response?.error || "Не удалось загрузить видео", request.status));
    };
    request.onerror = () => reject(new Error("Соединение прервано при загрузке видео"));
    request.ontimeout = () => reject(new Error("Не удалось завершить загрузку и проверку видео за 3 минуты. Попробуйте более короткий файл."));
    // Без multipart и буферизации на сервере: тело — исходный File.
    request.send(file);
  });
}
