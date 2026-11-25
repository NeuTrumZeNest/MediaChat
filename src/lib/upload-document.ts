import { UploadHttpError } from "./upload-error.ts";
import { DOCUMENT_UPLOAD_TIMEOUT_MS } from "./document-types.ts";
// XMLHttpRequest нужен для upload progress; fetch пока его не предоставляет.
export function uploadDocument(file: File, onProgress: (percent: number) => void, asFile = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/documents/upload?name=${encodeURIComponent(file.name)}${asFile ? "&asFile=1" : ""}`);
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.responseType = "json";
    request.timeout = DOCUMENT_UPLOAD_TIMEOUT_MS;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300 && request.response?.documentUrl) resolve(request.response.documentUrl);
      else reject(new UploadHttpError(request.response?.error || "Не удалось загрузить документ", request.status));
    };
    request.onerror = () => reject(new Error("Соединение прервано при загрузке документа"));
    request.ontimeout = () => reject(new Error("Загрузка заняла слишком много времени. Попробуйте снова."));
    request.send(file);
  });
}
