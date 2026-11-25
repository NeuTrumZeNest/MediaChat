"use client";

import MediaChatImage from './MediaChatImage';

export default function MediaChatAlbum({ urls, author, own, galleryUrls, centered = false }: { centered?: boolean; urls: string[]; author: string; own: boolean; galleryUrls?: string[] }) {
  if (urls.length === 1) return <MediaChatImage galleryUrls={galleryUrls || urls} imageUrl={urls[0]} alt={`Изображение от ${author}`} align={centered ? 'center' : own ? 'right' : 'left'} />;
  return <div aria-label={`Альбом: ${urls.length} фото`} style={{
    display: 'grid', gridTemplateColumns: `repeat(${urls.length === 2 || urls.length === 4 ? 2 : 3}, minmax(0, 1fr))`,
    marginInline: centered ? 'auto' : undefined, gap: 3, width: 'min(420px, 100%)', borderRadius: 12, overflow: 'hidden',
  }}>{urls.map((url, index) => <MediaChatImage key={url} galleryUrls={galleryUrls || urls} imageUrl={url} tile alt={`Фото ${index + 1} от ${author}`} />)}</div>;
}
