import { spawn } from "node:child_process";
import { InputError } from "./request-body.ts";

export async function runMediaProcess(executable: string, args: string[], signal?: AbortSignal, timeoutMs = 90_000): Promise<string> {
  if (signal?.aborted) throw new InputError("Загрузка отменена", 408);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH, LANG: "C", NODE_ENV: process.env.NODE_ENV || "development" } });
    let output = "";
    let stderr = "";
    let failure: Error | null = null;
    const stop = (error: Error) => { failure = error; child.kill("SIGKILL"); };
    const abort = () => stop(new InputError("Загрузка отменена", 408));
    const timer = setTimeout(() => stop(new InputError("Видео слишком сложно для обработки или повреждено. Попробуйте более короткий файл.", 422)), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 128 * 1024) stop(new InputError("Слишком много метаданных видео", 422));
    });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 8192) stderr += chunk.toString(); });
    child.once("error", (error: NodeJS.ErrnoException) => {
      cleanup();
      reject(error.code === "ENOENT" ? new InputError("На сервере не установлен FFmpeg/FFprobe. Обратитесь к администратору.", 503) : error);
    });
    child.once("close", (code) => {
      cleanup();
      if (failure) reject(failure);
      else if (code !== 0) {
        // Не отправляем клиенту пути к файлам или сырой вывод FFmpeg.
        if (stderr) console.warn("Не удалось обработать видео:", stderr.slice(0, 500));
        reject(new InputError("Видео повреждено или не удалось декодировать его содержимое", 415));
      } else resolve(output);
    });
    if (signal?.aborted) abort();
  });
}
