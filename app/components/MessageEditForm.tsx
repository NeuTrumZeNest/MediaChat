"use client";
import { useState } from 'react';
import styles from './MessageActions.module.css';
export default function MessageEditForm({ text, busy, onSave, onCancel, allowEmpty = false }: { text: string; busy: boolean; allowEmpty?: boolean; onSave: (text: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(text);
  return <form className={styles.editor} onSubmit={(event) => { event.preventDefault(); if (!busy && (allowEmpty || value.trim())) onSave(value); }}>
    <label htmlFor="message-edit-text">Редактирование сообщения</label>
    <textarea id="message-edit-text" value={value} maxLength={4000} disabled={busy} autoFocus onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onCancel(); }
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
    }} />
    <button type="submit" disabled={busy || (!allowEmpty && !value.trim())}>{busy ? 'Сохранение…' : 'Сохранить'}</button>
    <button type="button" disabled={busy} onClick={onCancel}>Отмена</button>
  </form>;
}
