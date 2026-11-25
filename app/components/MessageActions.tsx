"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Reply, Pencil, Trash2 } from 'lucide-react';
import styles from './MessageActions.module.css';

export type MessageMenuPosition = { x: number; y: number; trigger: HTMLElement };

export function MessageActionTarget({ id, author, children, style, highlighted, onOpen }: {
  id: number; author: string; children: ReactNode; style: CSSProperties; highlighted: boolean;
  onOpen: (position: MessageMenuPosition) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const consumed = useRef(false);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const ignore = (target: EventTarget) => target instanceof Element && Boolean(target.closest('[role="dialog"], input, textarea, [contenteditable="true"]'));
  return <div id={`message-${id}`} data-message-id={id} role="article" aria-label={`Сообщение: ${author}`} tabIndex={0}
    className={`${styles.target} ${highlighted ? styles.highlight : ''}`} style={style}
    onContextMenu={(event) => {
      if (ignore(event.target)) return;
      event.preventDefault(); clear(); consumed.current = true; onOpen({ x: event.clientX, y: event.clientY, trigger: event.currentTarget });
    }}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect();
        onOpen({ x: rect.left + rect.width / 2, y: Math.max(8, rect.top + 20), trigger: event.currentTarget });
      }
    }}
    onPointerDown={(event) => {
      clear(); consumed.current = false;
      if (event.pointerType !== 'touch' || !event.isPrimary || ignore(event.target)) return;
      start.current = { x: event.clientX, y: event.clientY };
      const trigger = event.currentTarget;
      timer.current = setTimeout(() => { consumed.current = true; onOpen({ ...start.current, trigger }); }, 550);
    }}
    onPointerMove={(event) => { if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 10) clear(); }}
    onPointerUp={clear} onPointerCancel={clear}
    onClickCapture={(event) => { if (consumed.current) { consumed.current = false; event.preventDefault(); event.stopPropagation(); } }}
  >{children}</div>;
}

export default function MessageActionsMenu({ position, canCopy, canEdit, canDelete, onCopy, onReply, onEdit, onDelete, onClose }: {
  position: MessageMenuPosition; canCopy: boolean; canEdit: boolean; canDelete: boolean;
  onCopy: () => void; onReply: () => void; onEdit: () => void; onDelete: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exiting = useRef(false);
  const [closing, setClosing] = useState(false);
  const close = useCallback((restore = false) => {
    if (exiting.current) return;
    exiting.current = true; setClosing(true);
    if (restore && position.trigger.isConnected) position.trigger.focus({ preventScroll: true });
    timer.current = setTimeout(onClose, 120);
  }, [onClose, position.trigger]);
  useLayoutEffect(() => {
    const menu = ref.current; if (!menu) return;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8))}px`;
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [position]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (document.activeElement?.closest('dialog[open]')) return; if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); } };
    const changed = () => close();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', changed); document.addEventListener('wheel', changed, true); document.addEventListener('touchmove', changed, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', changed); document.removeEventListener('wheel', changed, true); document.removeEventListener('touchmove', changed, true);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [close]);
  const action = (run: () => void, restore = false) => { if (!exiting.current) { run(); close(restore); } };
  return createPortal(<div ref={ref} role="menu" aria-label="Действия сообщения" className={`${styles.menu} ${closing ? styles.closing : ''}`}
    style={{ left: position.x, top: position.y }} onContextMenu={(event) => event.preventDefault()}
    onKeyDown={(event) => {
      const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        items[next]?.focus();
      } else if (event.key === 'Tab') { event.preventDefault(); close(true); }
    }}>
    <button type="button" role="menuitem" disabled={!canCopy} title={canCopy ? undefined : 'В сообщении нет текста'} onClick={() => action(onCopy, true)}><Copy size={18} />Скопировать</button>
    <button type="button" role="menuitem" onClick={() => action(onReply)}><Reply size={18} />Ответить</button>
    <button type="button" role="menuitem" disabled={!canEdit} title={canEdit ? undefined : 'Текст можно изменить только у собственных сообщений'} onClick={() => action(onEdit)}><Pencil size={18} />Изменить</button>
    <button type="button" role="menuitem" className={styles.destructive} disabled={!canDelete} title={canDelete ? undefined : 'Удалять можно только собственные сообщения'} onClick={() => action(onDelete)}><Trash2 size={18} />Удалить</button>
  </div>, document.body);
}
