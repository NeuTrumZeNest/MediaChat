// Лимиты на один процесс. Для нескольких Node workers нужен общий store.
type Bucket = { count: number; until: number };
const buckets = new Map<string, Bucket>();

export function consumeLimit(key: string, max: number, windowMs: number, now = Date.now()) {
  let bucket = buckets.get(key);
  if (!bucket || bucket.until <= now) {
    // Ограничиваем память и не позволяем обходить лимит вытеснением активных ключей.
    if (buckets.size >= 10_000) {
      for (const [id, value] of buckets) if (value.until <= now) buckets.delete(id);
      if (buckets.size >= 10_000) return Math.ceil(windowMs / 1000);
    }
    bucket = { count: 0, until: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count++;
  return bucket.count > max ? Math.max(1, Math.ceil((bucket.until - now) / 1000)) : 0;
}

export function authRateLimit(request: Request, action: "login" | "register") {
  // server.js всегда перезаписывает этот заголовок адресом TCP-соединения.
  const address = request.headers.get("x-mediachat-client-ip") || "shared";
  return consumeLimit(`${action}:${address}`, action === "login" ? 20 : 5,
    action === "login" ? 15 * 60_000 : 60 * 60_000);
}
