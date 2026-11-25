type MediaKind = "audio" | "video";
type RepeatStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): RepeatStorage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

export function readMediaRepeat(kind: MediaKind, storage: RepeatStorage | null = browserStorage()): boolean {
  try { return storage?.getItem(`mediachat.repeat.${kind}`) === "true"; }
  catch { return false; }
}

export function saveMediaRepeat(kind: MediaKind, repeat: boolean, storage: RepeatStorage | null = browserStorage()) {
  try { storage?.setItem(`mediachat.repeat.${kind}`, String(repeat)); }
  catch { /* Запрет storage не мешает переключению повтора текущего файла. */ }
}
