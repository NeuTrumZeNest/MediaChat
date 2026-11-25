'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, Search, X } from 'lucide-react';
import styles from './ConversationList.module.css';
export type Peer = { id: number; username: string; avatarUrl?: string | null };
export type DirectConversation = { id: number; kind?: string; title?: string | null; avatarUrl?: string | null; memberCount?: number; myRole?: string; peer: Peer; preview: string; updatedAt: string; lastMessageId: number | null };
export function Avatar({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  return <span aria-hidden="true" className={styles.avatar} style={{ overflow: 'hidden', width: size, height: size }}>{url ?
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : name.charAt(0).toUpperCase()}</span>;
}

function UserDialog({ initialPeer, onClose, onStart }: { initialPeer?: Peer; onClose: () => void; onStart: (peer: Peer) => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<Peer[]>([]);
  const [peer, setPeer] = useState(initialPeer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!initialPeer);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  useEffect(() => {
    if (peer) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError('');
      void fetch(`/api/users?q=${encodeURIComponent(query)}`, { signal: controller.signal, cache: 'no-store' })
        .then(async (response) => { if (!response.ok) throw new Error('Не удалось найти пользователей'); return response.json(); })
        .then((data) => setUsers(data.users)).catch((error) => { if (!controller.signal.aborted) setError(error.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, peer]);
  useEffect(() => {
    const update = (event: Event) => { const profile = (event as CustomEvent<Peer>).detail; setUsers((items) => items.map((item) => item.id === profile.id ? profile : item)); setPeer((item) => item?.id === profile.id ? profile : item); };
    window.addEventListener('mediachat-profile-updated', update); return () => window.removeEventListener('mediachat-profile-updated', update);
  }, []);
  return createPortal(<dialog ref={ref} className={styles.dialog} aria-label={peer ? 'Профиль пользователя' : 'Поиск пользователей'} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className={styles.title}><span>{peer ? 'Профиль пользователя' : 'Новая переписка'}</span><button autoFocus aria-label="Закрыть" className={styles.icon} disabled={busy} onClick={onClose}><X size={20} /></button></div>
    {peer ? <div style={{ textAlign: 'center', marginTop: 24 }}><Avatar name={peer.username} url={peer.avatarUrl} /><p style={{ overflowWrap: 'anywhere' }}>{peer.username}</p><button className={styles.primary} disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onStart(peer); onClose(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } }}>{busy ? 'Открываем…' : 'Написать'}</button></div>
      : <><input aria-label="Имя пользователя" placeholder="Найти по имени" value={query} onChange={(event) => setQuery(event.target.value)} /><div style={{ maxHeight: '45dvh', overflow: 'auto' }}>{loading ? <p role="status">Поиск…</p> : users.length ? users.map((user) => <button key={user.id} className={styles.row} onClick={() => setPeer(user)}><Avatar name={user.username} url={user.avatarUrl} /><span className={styles.details}>{user.username}</span></button>) : <p>Пользователи не найдены</p>}</div></>}
    {error && <p role="alert">{error}</p>}
  </dialog>, document.body);
}
export function PeerProfile({ peer, onClose, onStart }: { peer: Peer; onClose: () => void; onStart: (peer: Peer) => Promise<void> }) { return <UserDialog initialPeer={peer} onClose={onClose} onStart={onStart} />; }
export default function ConversationList({ items, selected, onSelect, onStart, error, loading, onRetry }: { items: DirectConversation[]; selected: number | null; onSelect: (id: number | null) => void; onStart: (peer: Peer) => Promise<void>; error: string; loading: boolean; onRetry: () => void }) {
  const [search, setSearch] = useState(false);
  return <>
    <button className={styles.row} onClick={() => setSearch(true)} aria-label="Найти пользователя"><Search size={21} /><span className={styles.details}>Найти пользователя</span></button>
    <nav className={styles.list} aria-label="Переписки">
      <button className={`${styles.row} ${selected === null ? styles.selected : ''}`} aria-current={selected === null ? 'page' : undefined} onClick={() => onSelect(null)} title="Общий чат"><span className={styles.avatar}><MessageCircle size={21} /></span><span className={styles.details}>Общий чат</span></button>
      {items.map((item) => <button key={item.id} className={`${styles.row} ${selected === item.id ? styles.selected : ''}`} aria-current={selected === item.id ? 'page' : undefined} title={item.peer.username} onClick={() => onSelect(item.id)}><Avatar name={item.peer.username} url={item.peer.avatarUrl} /><span className={styles.details}><span className={styles.name} style={{ display: 'block' }}>{item.peer.username}</span><span className={styles.preview} style={{ display: 'block' }}>{item.preview}</span></span><time className={styles.time} dateTime={item.updatedAt}>{new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(new Date(item.updatedAt))}</time></button>)}
      {loading && <p className={styles.empty} role="status">Загрузка переписок…</p>}
      {!loading && !items.length && !error && <p className={styles.empty}>Личных переписок пока нет. Найдите пользователя, чтобы начать общение.</p>}
      {error && <button className={styles.row} onClick={onRetry} title={error}>Повторить загрузку</button>}
    </nav>
    {search && <UserDialog onClose={() => setSearch(false)} onStart={onStart} />}
  </>;
}
