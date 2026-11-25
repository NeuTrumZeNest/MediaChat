export type MediaVolumeKind = "audio" | "video";
type VolumeStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): VolumeStorage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

export function readMediaVolume(kind: MediaVolumeKind, storage: VolumeStorage | null = browserStorage()): number {
  try {
    const stored = storage?.getItem(`mediachat.volume.${kind}`);
    if (stored == null || stored.trim() === "") return 1;
    const volume = Number(stored);
    return Number.isFinite(volume) && volume >= 0 && volume <= 1 ? volume : 1;
  } catch { return 1; }
}

export function saveMediaVolume(kind: MediaVolumeKind, volume: number, storage: VolumeStorage | null = browserStorage()) {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) return;
  // Приватный режим/запрет storage не должны мешать воспроизведению.
  try { storage?.setItem(`mediachat.volume.${kind}`, String(volume)); }
  catch { /* Громкость текущего плеера продолжает работать без сохранения. */ }
}
