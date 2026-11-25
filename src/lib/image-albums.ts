export const MAX_ALBUM_IMAGES = 9;

export function normalizeImageUrls(value: unknown, legacy: unknown): string[] {
  if (value === undefined) {
    if (legacy == null || legacy === "") return [];
    if (typeof legacy !== "string") throw new Error("Некорректное изображение");
    return [legacy];
  }
  if (!Array.isArray(value) || value.length > MAX_ALBUM_IMAGES ||
      value.some((url) => typeof url !== "string" || !/^\/api\/images\/[0-9a-f-]{36}\.(png|jpg|webp|gif)$/i.test(url)) ||
      new Set(value).size !== value.length ||
      (legacy != null && legacy !== value[0])) {
    throw new Error("В альбоме должно быть не больше 9 разных изображений");
  }
  return value;
}

export function storedImageUrls(images: { imageUrl: string; position: number }[], legacy?: string | null): string[] {
  return images.length ? [...images].sort((a, b) => a.position - b.position).map((image) => image.imageUrl) : legacy ? [legacy] : [];
}
