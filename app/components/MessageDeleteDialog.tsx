"use client";
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './MessageActions.module.css';
export default function MessageDeleteDialog({ busy, error, onConfirm, onCancel }: { busy: boolean; error?: string; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current; dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  return createPortal(<dialog ref={ref} role="alertdialog" aria-labelledby="delete-message-title" aria-describedby="delete-message-description" className={styles.deleteDialog}
    onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onCancel(); } }}>
    <form onSubmit={(event) => { event.preventDefault(); if (!busy) onConfirm(); }}>
      <h2 id="delete-message-title">Удалить сообщение у всех?</h2>
      <p id="delete-message-description">Сообщение исчезнет у всех участников. Неиспользуемые копии вложений на сервере тоже будут удалены. Файлы на вашем устройстве останутся.</p>
      {error && <p role="alert" style={{ marginTop: 12, color: "#ff929b" }}>{error}</p>}
      <footer><button type="button" disabled={busy} autoFocus onClick={onCancel}>Отмена</button><button type="submit" disabled={busy}>{busy ? 'Удаление…' : 'Удалить у всех'}</button></footer>
    </form>
  </dialog>, document.body);
}
