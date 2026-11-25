'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Avatar, type Peer } from './ConversationList';
import AvatarEditor from './AvatarEditor';
import styles from './ConversationList.module.css';
type Member = Peer & { role: string };
type Info = { id: number; title: string; avatarUrl: string | null; members: Member[]; myRole: string };
const roleName = (role: string) => role === 'owner' ? 'Владелец' : role === 'admin' ? 'Администратор' : 'Участник';
export default function GroupDialog({ id, onClose, onCreated, onChanged }: { id?: number; onClose: () => void; onCreated: (id: number) => void; onChanged: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [info, setInfo] = useState<Info | null>(null), [title, setTitle] = useState('');
  const [query, setQuery] = useState(''), [results, setResults] = useState<Peer[]>([]), [chosen, setChosen] = useState<Peer[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [avatar, setAvatar] = useState(false), [withAvatar, setWithAvatar] = useState(false), [created, setCreated] = useState<number | null>(null);
  useEffect(() => { const node = ref.current; node?.showModal(); return () => node?.close(); }, []);
  const load = useCallback(async () => {
    if (!id) return;
    const response = await fetch(`/api/groups/${id}`, { cache: 'no-store' }); const data = await response.json();
    if (!response.ok) throw new Error(data.error); setInfo(data); setTitle(data.title);
  }, [id]);
  useEffect(() => { let active = true; const run = () => { void load().catch((e) => { if (active) setError(e.message); }); }; run(); window.addEventListener('mediachat-conversations-updated', run); return () => { active = false; window.removeEventListener('mediachat-conversations-updated', run); }; }, [load]);
  useEffect(() => {
    const controller = new AbortController(); const timer = setTimeout(() => {
      void fetch(`/api/users?q=${encodeURIComponent(query)}`, { signal: controller.signal, cache: 'no-store' }).then(async (r) => { if (!r.ok) throw new Error('Поиск недоступен'); return r.json(); }).then((d) => setResults(d.users)).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    }, 200); return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  useEffect(() => {
    const update = (event: Event) => { const profile = (event as CustomEvent<Peer>).detail; setResults((items) => items.map((item) => item.id === profile.id ? profile : item)); setChosen((items) => items.map((item) => item.id === profile.id ? profile : item)); };
    window.addEventListener('mediachat-profile-updated', update); return () => window.removeEventListener('mediachat-profile-updated', update);
  }, []);
  async function change(action: string, value?: unknown) {
    setBusy(true); setError('');
    try { const response = await fetch(`/api/groups/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, value }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); onChanged(); if (action === 'leave' || action === 'delete') onClose(); else await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function create() {
    setBusy(true); setError('');
    try { const response = await fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, userIds: chosen.map((u) => u.id) }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); if (withAvatar) { setCreated(data.conversationId); setAvatar(true); } else { onCreated(data.conversationId); onClose(); } }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const manages = info && info.myRole !== 'member';
  return createPortal(<><dialog ref={ref} className={styles.dialog} aria-label={id ? 'Информация о группе' : 'Создать группу'} onCancel={(e) => { e.preventDefault(); if (!busy && !avatar) onClose(); }}>
    <div className={styles.title}><span>{id ? 'Информация о группе' : 'Новая группа'}</span><button autoFocus className={styles.icon} disabled={busy} aria-label="Закрыть группу" onClick={onClose}><X size={20} /></button></div>
    {id && info ? <><button className={styles.row} disabled={!manages} aria-label="Изменить аватарку группы" onClick={() => setAvatar(true)}><Avatar name={info.title} url={info.avatarUrl} /><span>{info.title}</span></button><p>{info.members.length} участников · {roleName(info.myRole)}</p>
      {manages && <><input aria-label="Название группы" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /><button className={styles.primary} disabled={busy || !title.trim()} onClick={() => { void change('title', title); }}>Сохранить название</button></>}
      <div style={{ maxHeight: '35dvh', overflow: 'auto' }}>{info.members.map((member) => <div key={member.id} style={{ borderBottom: '1px solid #343844', padding: '10px 0' }}><div className={styles.row} style={{ margin: 0 }}><Avatar name={member.username} url={member.avatarUrl} /><span style={{ overflowWrap: 'anywhere' }}>{member.username}<small style={{ display: 'block', color: '#aaa' }}>{roleName(member.role)}</small></span></div>
        {member.role !== 'owner' && manages && (info.myRole === 'owner' || member.role === 'member') && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}><button disabled={busy} onClick={() => { void change('remove', member.id); }} aria-label={`Исключить ${member.username}`}>Исключить</button>{info.myRole === 'owner' && <><button disabled={busy} onClick={() => { void change(member.role === 'admin' ? 'member' : 'admin', member.id); }} aria-label={`Изменить роль ${member.username}`}>{member.role === 'admin' ? 'Снять администратора' : 'Сделать администратором'}</button><button disabled={busy} onClick={() => { if (window.confirm(`Передать владение пользователю ${member.username}?`)) void change('transfer', member.id); }}>Передать владение</button></>}</div>}
      </div>)}</div>
      {info.myRole === 'owner' ? <><p style={{ color: '#aaa', fontSize: 12 }}>Перед выходом передайте владение другому участнику.</p><button className={styles.row} disabled={busy} onClick={() => { if (window.confirm('Удалить группу для всех участников?')) void change('delete'); }}>Удалить группу</button></> : <button className={styles.row} disabled={busy} onClick={() => { void change('leave'); }}>Покинуть группу</button>}
    </> : !id && <><input aria-label="Название новой группы" maxLength={80} placeholder="Название группы" value={title} onChange={(e) => setTitle(e.target.value)} /><p>Выбрано: {chosen.length}</p>{chosen.map((u) => <button key={u.id} className={styles.row} onClick={() => setChosen((old) => old.filter((m) => m.id !== u.id))}>{u.username} ×</button>)}<label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input style={{ width: 'auto' }} type="checkbox" checked={withAvatar} onChange={(e) => setWithAvatar(e.target.checked)} />Выбрать аватарку после создания</label></>}
    {(!id || manages) && <><input aria-label="Найти участника" placeholder="Найти пользователя" value={query} onChange={(e) => setQuery(e.target.value)} /><div style={{ maxHeight: '20dvh', overflow: 'auto' }}>{results.filter((u) => !chosen.some((m) => m.id === u.id) && !info?.members.some((m) => m.id === u.id)).map((u) => <button disabled={busy || chosen.length >= 49} key={u.id} className={styles.row} onClick={() => { if (id) void change('add', u.id); else setChosen((old) => [...old, u]); }}><Avatar name={u.username} url={u.avatarUrl} /><span>{u.username}</span><span>+</span></button>)}</div></>}
    {!id && !created && <button className={styles.primary} disabled={busy || !chosen.length || !title.trim()} onClick={() => { void create(); }}>Создать группу</button>}{error && <p role="alert">{error}</p>}
  </dialog>{avatar && <AvatarEditor endpoint={`/api/groups/${id ?? created}/avatar`} onSaved={() => { onChanged(); if (!created) void load(); }} onClose={() => { setAvatar(false); if (created) { onCreated(created); onClose(); } }} />}</>, document.body);
}
