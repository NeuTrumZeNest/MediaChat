export function parseRange(range: string | null, size: number): { start: number; end: number; status: 200 | 206 } | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  if (range === null) return { start: 0, end: size - 1, status: 200 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1, status: 206 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || start > requestedEnd) return null;
  return { start, end: Math.min(requestedEnd, size - 1), status: 206 };
}
