export class InputError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export async function readLimitedBody(request: Request, max: number): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > max)) {
    throw new InputError("Слишком большой запрос", 413);
  }
  if (!request.body) throw new InputError("Пустой запрос");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new InputError("Слишком большой запрос", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export async function limitedJson(request: Request): Promise<unknown> {
  const body = await readLimitedBody(request, 8192);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
  catch { throw new InputError("Некорректный формат JSON"); }
}

export async function limitedFormData(request: Request, maxFileSize: number) {
  const body = await readLimitedBody(request, maxFileSize + 64 * 1024);
  return new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type") || "" }, body: body as Uint8Array<ArrayBuffer> }).formData();
}
