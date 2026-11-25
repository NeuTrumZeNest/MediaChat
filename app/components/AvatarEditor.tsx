'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './ConversationList.module.css';
export default function AvatarEditor({ endpoint, onClose, onSaved }: { endpoint: string; onClose: () => void; onSaved: (url: string | null) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState('');
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [zoom, setZoom] = useState(1), [x, setX] = useState(.5), [y, setY] = useState(.5);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { mountedRef.current = true; const node = dialog.current; node?.showModal(); return () => { mountedRef.current = false; requestRef.current?.abort(); node?.close(); }; }, []);
  function closeEditor() { requestRef.current?.abort(); dialog.current?.close(); onClose(); }
  useEffect(() => { if (!file) return; let active = true; const url = URL.createObjectURL(file); const image = new Image(); image.onload = () => { if (!active) return; setSource(url); setDimensions({ width: image.naturalWidth, height: image.naturalHeight }); setZoom(1); setX(.5); setY(.5); }; image.onerror = () => { if (active) setError('Не удалось прочитать изображение'); }; image.src = url; return () => { active = false; URL.revokeObjectURL(url); }; }, [file]);
  const side = Math.min(dimensions.width, dimensions.height) / zoom;
  const left = (dimensions.width - side) * x, top = (dimensions.height - side) * y;
  async function save(remove = false) {
    if (requestRef.current) return;
    const controller = new AbortController(); requestRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 30000);
    setBusy(true); setError('');
    try {
      let body: FormData | undefined;
      if (!remove) { if (!file || !source) throw new Error('Выберите изображение'); body = new FormData(); body.append('avatar', file); body.append('crop', JSON.stringify({ x: left / dimensions.width, y: top / dimensions.height, size: side / Math.min(dimensions.width, dimensions.height) })); }
      const response = await fetch(endpoint, { method: remove ? 'DELETE' : 'POST', body, signal: controller.signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Не удалось сохранить аватарку'); if (!mountedRef.current) return; onSaved(data.avatarUrl); closeEditor();
    } catch (error) { if (mountedRef.current) setError(controller.signal.aborted ? 'Сервер не ответил за 30 секунд. Проверьте соединение. Изменение могло сохраниться — проверьте профиль перед повтором.' : (error as Error).message); } finally { clearTimeout(timer); if (requestRef.current === controller) requestRef.current = null; if (mountedRef.current) setBusy(false); }
  }
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-label="Изменение аватарки" onCancel={(e) => { e.preventDefault(); closeEditor(); }}>
    <h3>Аватарка</h3><input aria-label="Выбрать аватарку" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { const picked = event.target.files?.[0]; if (!picked) return; if (!['image/jpeg', 'image/png', 'image/webp'].includes(picked.type) || picked.size > 10 * 1024 * 1024 || !picked.size) { setError('Выберите JPEG, PNG или WebP до 10 МБ'); return; } setFile(picked); setSource(''); setError(''); }} />
    {source && <><div aria-label="Предпросмотр аватарки" style={{ width: 220, height: 220, borderRadius: '50%', overflow: 'hidden', position: 'relative', margin: '12px auto', background: '#111' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={source} alt="Область обрезки" draggable={false} style={{ position: 'absolute', maxWidth: 'none', width: `${dimensions.width / side * 100}%`, height: `${dimensions.height / side * 100}%`, left: `${-left / side * 100}%`, top: `${-top / side * 100}%` }} />
    </div><label>Масштаб<input aria-label="Масштаб обрезки" type="range" disabled={busy} min="1" max="4" step=".01" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label><label>По горизонтали<input aria-label="Положение по горизонтали" type="range" disabled={busy} min="0" max="1" step=".01" value={x} onChange={(e) => setX(Number(e.target.value))} /></label><label>По вертикали<input aria-label="Положение по вертикали" type="range" disabled={busy} min="0" max="1" step=".01" value={y} onChange={(e) => setY(Number(e.target.value))} /></label></>}
    {error && <p role="alert">{error}</p>}<button className={styles.primary} disabled={busy || !source} onClick={() => { void save(); }}>Сохранить</button><button className={styles.row} disabled={busy} onClick={() => { void save(true); }}>Удалить аватарку</button><button className={styles.row} onClick={closeEditor}>Отмена</button>
  </dialog>, document.body);
}
