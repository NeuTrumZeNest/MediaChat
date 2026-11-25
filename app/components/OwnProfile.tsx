'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar, type Peer } from './ConversationList';
import AvatarEditor from './AvatarEditor';
import styles from './ConversationList.module.css';
export default function OwnProfile({ user, onClose, onSaved }: { user: Peer; onClose: () => void; onSaved: (url: string | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null), [editing, setEditing] = useState(false);
  useEffect(() => { const node = ref.current; node?.showModal(); return () => node?.close(); }, []);
  return createPortal(<><dialog ref={ref} className={styles.dialog} aria-label="Мой профиль" onCancel={(e) => { e.preventDefault(); if (!editing) onClose(); }}>
    <h3>Мой профиль</h3><button type="button" className={styles.row} aria-label="Изменить мою аватарку" onClick={() => setEditing(true)}><Avatar name={user.username} url={user.avatarUrl} /><span>{user.username}</span></button><p style={{ color: '#aaa', fontSize: 13 }}>Нажмите на аватарку, чтобы выбрать изображение или удалить текущее.</p><button className={styles.primary} onClick={onClose}>Закрыть профиль</button>
  </dialog>{editing && <AvatarEditor endpoint="/api/profile/avatar" onSaved={onSaved} onClose={() => setEditing(false)} />}</>, document.body);
}
