"use client";

import GroupDialog from "./components/GroupDialog";
import OwnProfile from "./components/OwnProfile";
import ConversationList, { Avatar, PeerProfile, type DirectConversation, type Peer } from "./components/ConversationList";
import { Suspense } from "react";
import MessageActionsMenu, { MessageActionTarget, type MessageMenuPosition } from "./components/MessageActions";
import MessageDeleteDialog from "./components/MessageDeleteDialog";
import MessageEditForm from "./components/MessageEditForm";
import actionStyles from "./components/MessageActions.module.css";
import { canEditMessageText, hasMessageAttachments, messagePreview, type ReplySummary } from "../src/lib/message-actions";
import { mergeMessageHistory, type MessageEdit } from "../src/lib/message-merge";
import { X } from "lucide-react";
import layout from "./ChatLayout.module.css";
import AttachmentDraft from "./components/AttachmentDraft";
import MediaChatAlbum from "./components/MediaChatAlbum";
import { groupAttachments, uploadAttachment, appendAttachmentSelection, type AttachmentKind, type DraftAttachment } from "../src/lib/attachment-batch";
import MediaChatVideo from "./components/MediaChatVideo";
import { type VideoInfo } from "../src/lib/video-types";


import AttachmentMenu from "./components/AttachmentMenu";
import MediaChatDocument from "./components/MediaChatDocument";
import type { DocumentInfo } from "../src/lib/document-types";

import MediaChatAudioAttachment from "./components/MediaChatAudioAttachment";

import MediaChatAudio, { type AudioPlayerHandle } from "./components/MediaChatAudio";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { io, Socket } from "socket.io-client";

import { flushSync } from "react-dom";

type User = {
  id: number;
  username: string;
  avatarUrl?: string | null;
};

type Message = {
  avatarUrl?: string | null;
  conversationId?: number | null;
  id: number;
  author: string;
  text: string;
  editedAt?: string | null;
  replyToId?: number | null;
  replyTo?: ReplySummary | null;
  imageUrl?: string | null;
  imageUrls?: string[];
  audioUrl?: string | null;
  audioName?: string | null;
  videoUrl?: string | null;
  video?: VideoInfo | null;
  documentUrl?: string | null;
  document?: DocumentInfo | null;
  userId?: number;
  system?: boolean;
  createdAt?: string;
};

const systemMessage: Message = {
  id: -1,
  author: "System",
  text: "Добро пожаловать в ЧАТ",
  system: true,
};

function formatMessageDate(value?: string) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

type PendingSend = {
  conversationId: number | null;
  text: string;
  replyToId: number | null;
  groups: { items: DraftAttachment[]; clientMessageId: string }[];
  next: number;
};


function createClientMessageId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type ChatDraft = { message: string; attachments: DraftAttachment[]; replying: Message | null };
export default function Home() {
  return <Suspense fallback={<main style={{ background: '#0d1015', color: 'white', padding: 24 }}>Загрузка MediaChat…</main>}><ChatRoute /></Suspense>;
}
function ChatRoute() {
  const params = useSearchParams();
  const raw = params.get('chat');
  const scope = raw === null ? null : /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : -1;
  const [drafts] = useState(() => new Map<number | null, ChatDraft>());
  const saveDraft = useCallback((id: number | null, draft: ChatDraft) => { drafts.set(id, draft); }, [drafts]);
  const select = useCallback((id: number | null) => {
    const url = new URL(window.location.href);
    if (id === null) url.searchParams.delete('chat'); else url.searchParams.set('chat', String(id));
    window.history.pushState(null, '', url);
  }, []);
  return <Chat key={scope ?? 'general'} scope={scope} onSelect={select} initialDraft={drafts.get(scope)} saveDraft={saveDraft} />;
}
function Chat({ scope, onSelect, initialDraft, saveDraft }: { scope: number | null; onSelect: (id: number | null) => void; initialDraft?: ChatDraft; saveDraft: (id: number | null, draft: ChatDraft) => void }) {
  const router = useRouter();
  const composerRef = useRef<HTMLInputElement>(null);
  const deletedIdsRef = useRef(new Set<number>());
  const deleteLockRef = useRef(false);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [savingDelete, setSavingDelete] = useState(false);
  const latestEditsRef = useRef(new Map<number, MessageEdit>());
  const editLockRef = useRef(false);
  const [menu, setMenu] = useState<{ id: number; position: MessageMenuPosition; token: number } | null>(null);
  const [replying, setReplying] = useState<Message | null>(initialDraft?.replying ?? null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [notice, setNotice] = useState('');
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 2600); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (highlighted === null) return; const timer = setTimeout(() => setHighlighted(null), 1600); return () => clearTimeout(timer); }, [highlighted]);

  const activeAudioIdRef = useRef<number | null>(null);
  const audioPlayerRef = useRef<AudioPlayerHandle>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const lastScrollInteractionRef = useRef(0);
  const stickToBottomRef = useRef(true);
  const socketRef = useRef<Socket | null>(null);
  const sendingLockRef = useRef(false);
  const pendingSendRef = useRef<PendingSend | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const authenticatedUserId = user?.id;
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [sessionAttempt, setSessionAttempt] = useState(0);

  const [activeAudio, setActiveAudio] = useState<{
  id: number;
  url: string;
} | null>(null);

  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState(initialDraft?.message ?? "");
  const [attachments, setAttachments] = useState<DraftAttachment[]>(initialDraft?.attachments ?? []);
  const [batchLocked, setBatchLocked] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [batchStatus, setBatchStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  const [messages, setMessages] = useState<Message[]>(scope === null ? [systemMessage] : []);
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const conversationsVersion = useRef(0);
  const [conversationError, setConversationError] = useState('');
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [ownProfile, setOwnProfile] = useState(false);
  const [groupDialog, setGroupDialog] = useState<number | 'new' | null>(null);
  const [profile, setProfile] = useState<Peer | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const historyLock = useRef(false);
  const historyVersion = useRef(0);
  const scopeAccessRef = useRef(true);
  const profileCacheRef = useRef(new Map<number, Peer>());
  const historyCursorRef = useRef<number | null>(null);
  const jumpLockRef = useRef(false);
  const receivedDuringHistory = useRef(new Map<number, Message>());
  const alive = useRef(true);
  const draftRef = useRef<ChatDraft>({ message: '', attachments: [], replying: null });
  useEffect(() => { draftRef.current = { message, attachments, replying }; }, [message, attachments, replying]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; saveDraft(scope, draftRef.current); }; }, [scope, saveDraft]);
  const refreshConversations = useCallback(async () => {
    const version = ++conversationsVersion.current;
    try {
      const response = await fetch('/api/conversations', { cache: 'no-store' });
      if (!response.ok) throw new Error('Не удалось загрузить переписки');
      const data = await response.json();
      if (alive.current && version === conversationsVersion.current) { setConversations(data.conversations.map((item: DirectConversation) => item.kind !== 'group' && profileCacheRef.current.has(item.peer.id) ? { ...item, peer: profileCacheRef.current.get(item.peer.id)! } : item)); setConversationError(''); }
    } catch (error) { if (alive.current && version === conversationsVersion.current) setConversationError((error as Error).message); }
    finally { if (alive.current && version === conversationsVersion.current) setConversationsLoading(false); }
  }, []);
  function selectConversation(id: number | null) {
    if (sendingLockRef.current || pendingSendRef.current || editLockRef.current || deleteLockRef.current) { setNotice('Сначала завершите текущую операцию'); return; }
    audioPlayerRef.current?.pause();
    onSelect(id);
  }
  async function startConversation(peer: Peer) {
    if (sendingLockRef.current || pendingSendRef.current || editLockRef.current || deleteLockRef.current) throw new Error('Сначала завершите текущую операцию');
    const response = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: peer.id }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось открыть переписку');
    selectConversation(data.conversationId);
  }
  const loadHistory = useCallback(async (before?: number) => {
    if (before && historyLock.current) return;
    if (before) historyLock.current = true;
    const version = ++historyVersion.current;
    receivedDuringHistory.current.clear();
    const list = messagesRef.current;
    const oldHeight = list?.scrollHeight ?? 0;
    const oldTop = list?.scrollTop ?? 0;
    try {
      setHistoryLoading(true);
      const query = new URLSearchParams();
      if (scope !== null) query.set('conversationId', String(scope));
      if (before) query.set('before', String(before));
      const response = await fetch(`/api/messages?${query}`, { cache: 'no-store' });
      if (!alive.current || version !== historyVersion.current) return;
      if (response.status === 401) { router.replace('/login'); return; }
      if (!response.ok) throw new Error(response.status === 403 ? 'Эта переписка вам недоступна' : 'Не удалось загрузить историю');
      const data = await response.json();
      if (!alive.current || version !== historyVersion.current) return;
      for (const id of data.deletedMessageIds || []) deletedIdsRef.current.add(id);
      scopeAccessRef.current = true;
      data.messages = data.messages.map((item: Message) => item.userId && profileCacheRef.current.has(item.userId) ? { ...item, avatarUrl: profileCacheRef.current.get(item.userId)!.avatarUrl } : item);
      historyCursorRef.current = data.nextCursor ?? null;
      // Reconnect refreshes the bounded recent window; older pages are fetched explicitly.
      flushSync(() => {
        setMessages((current) => mergeMessageHistory(before ? current : scope === null ? [systemMessage] : [], [...data.messages, ...receivedDuringHistory.current.values()], latestEditsRef.current, deletedIdsRef.current));
        setNextCursor(data.nextCursor ?? null); setHistoryError('');
      });
      if (before && list) { stickToBottomRef.current = false; list.scrollTop = oldTop + list.scrollHeight - oldHeight; }
      return true;
    } catch (error) { if (alive.current && version === historyVersion.current) setHistoryError((error as Error).message); }
    finally { if (version === historyVersion.current) { historyLock.current = false; if (alive.current) setHistoryLoading(false); } }
  }, [scope, router]);

  const recordDeletion = useCallback((id: number) => {
    document.getElementById(`message-${id}`)?.querySelectorAll<HTMLMediaElement>('audio, video').forEach((media) => media.pause());
    deletedIdsRef.current.add(id); latestEditsRef.current.delete(id);
    setMessages((current) => mergeMessageHistory(current, [], latestEditsRef.current, deletedIdsRef.current));
    setMenu((current) => current?.id === id ? null : current);
    setEditing((current) => current?.id === id ? null : current);
    setReplying((current) => current?.id === id ? null : current);
    setDeleting((current) => current?.id === id ? null : current);
    if (activeAudioIdRef.current === id) {
      audioPlayerRef.current?.pause(); activeAudioIdRef.current = null; setActiveAudio(null);
    }
  }, []);

  useLayoutEffect(() => {
    const list = messagesRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) list.scrollTop = list.scrollHeight;
    });
    observer.observe(list);
    // Изображения и метаданные медиа меняют высоту содержимого, но не viewport.
    if (messagesContentRef.current) observer.observe(messagesContentRef.current);
    return () => observer.disconnect();
  }, [checkingSession, user]);

  useLayoutEffect(() => {
    const list = messagesRef.current;
    if (list && stickToBottomRef.current) list.scrollTop = list.scrollHeight;
  }, [messages]);

  // 1. Проверяем сессию; ошибки сети не должны превращаться в бесконечный loader.
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timer = setTimeout(() => controller.abort(), 15_000);
    async function checkSession() {
      try {
        const response = await fetch('/api/me', { cache: 'no-store', signal: controller.signal });
        if (disposed) return;
        if (response.status === 401) {
          router.replace('/login');
          return;
        }
        if (!response.ok) throw new Error('Сервер не смог проверить сессию. Попробуйте ещё раз.');
        const data = await response.json();
        if (!data.user || !Number.isSafeInteger(data.user.id) || typeof data.user.username !== 'string') throw new Error('Сервер вернул некорректный ответ. Попробуйте ещё раз.');
        if (!disposed) setUser(data.user);
      } catch (error) {
        if (!disposed) setSessionError(controller.signal.aborted
          ? 'Сервер не ответил за 15 секунд. Проверьте Wi-Fi и подключение к MacBook.'
          : error instanceof TypeError ? 'Не удалось подключиться к серверу. Проверьте Wi-Fi и адрес сайта.'
          : (error as Error).message);
      } finally {
        clearTimeout(timer);
        if (!disposed) setCheckingSession(false);
      }
    }
    void checkSession();
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [router, sessionAttempt]);


  useEffect(() => {
    if (!authenticatedUserId) return;
    const timer = setTimeout(() => { void loadHistory(); }, 0);
    return () => clearTimeout(timer);
  }, [authenticatedUserId, loadHistory]);

  // 3. После определения пользователя подключаем Socket.IO
  useEffect(() => {
    if (!authenticatedUserId) {
      return;
    }

    const socket = io(window.location.origin, {
      transports: ["websocket", "polling"],
      tryAllTransports: true,
      reconnection: true,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log(
        "Socket.IO подключён:",
        socket.id
      );
      console.log(
        "Транспорт Socket.IO:",
        socket.io.engine.transport.name
      );

      setConnected(true);
      void refreshConversations();
      // Subscribe first, then fetch history: messages during the request are merged by id.
      socket.timeout(10000).emit('subscribe-conversation', { conversationId: scope }, (error: Error | null, result: { ok: boolean }) => {
        if (!alive.current || socketRef.current !== socket || !socket.connected) return;
        if (error || !result?.ok) { setHistoryLoading(false); setHistoryError('Эта переписка недоступна или сервер не ответил'); return; }
        void loadHistory();
      });
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("connect_error", (error) => {
      console.error(
        "Ошибка Socket.IO:",
        error.message
      );

      setConnected(false);

      if (
        error.message ===
          "Необходимо войти в аккаунт" ||
        error.message ===
          "Недействительная или истёкшая сессия"
      ) {
        router.replace("/login");
      }
    });

    socket.on(
      "chat-message",
      (newMessage: Message) => {
        void refreshConversations();
        if ((newMessage.conversationId ?? null) !== scope || !scopeAccessRef.current) return;
        if (newMessage.userId && profileCacheRef.current.has(newMessage.userId)) newMessage = { ...newMessage, avatarUrl: profileCacheRef.current.get(newMessage.userId)!.avatarUrl };
        receivedDuringHistory.current.set(newMessage.id, newMessage);
        setMessages((oldMessages) => mergeMessageHistory(oldMessages, [newMessage], latestEditsRef.current, deletedIdsRef.current));
      }
    );

    socket.on('conversations-changed', () => { void refreshConversations(); window.dispatchEvent(new Event('mediachat-conversations-updated')); });
    socket.on('conversation-revoked', ({ conversationId }: { conversationId: number }) => {
      void refreshConversations();
      if (scope === conversationId) {
        scopeAccessRef.current = false; historyVersion.current++; setHistoryLoading(false); setNextCursor(null);
        audioPlayerRef.current?.pause(); setActiveAudio(null); setMessages([]); setReplying(null); setEditing(null); setMenu(null); setGroupDialog(null);
        setHistoryError('Доступ к группе прекращён');
      }
    });
    socket.on('profile-updated', (profile: Peer) => {
      profileCacheRef.current.set(profile.id, profile);
      window.dispatchEvent(new CustomEvent('mediachat-profile-updated', { detail: profile }));
      setUser((current) => current?.id === profile.id ? { ...current, ...profile } : current);
      setProfile((current) => current?.id === profile.id ? { ...current, ...profile } : current);
      setConversations((current) => current.map((item) => item.kind !== 'group' && item.peer.id === profile.id ? { ...item, peer: profile } : item));
      setMessages((current) => current.map((item) => item.userId === profile.id ? { ...item, avatarUrl: profile.avatarUrl } : item));
      window.dispatchEvent(new Event('mediachat-conversations-updated'));
    });
    socket.on('message-deleted', ({ id, conversationId }: { id: number; conversationId?: number | null }) => { void refreshConversations(); if ((conversationId ?? null) === scope) recordDeletion(id); });
    socket.on('message-edited', (change: MessageEdit & { conversationId?: number | null }) => {
      void refreshConversations();
      if ((change.conversationId ?? null) !== scope) return;
      if (deletedIdsRef.current.has(change.id)) return;
      const old = latestEditsRef.current.get(change.id);
      if (!old || Date.parse(change.editedAt || '') >= Date.parse(old.editedAt || '')) latestEditsRef.current.set(change.id, change);
      setMessages((current) => mergeMessageHistory(current, [], latestEditsRef.current, deletedIdsRef.current));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  // Identity changes reconnect; avatar changes do not.
  }, [authenticatedUserId, router, recordDeletion, scope, loadHistory, refreshConversations]);

  function selectAttachments(files: File[], kind: AttachmentKind) {
    if (!files.length || sendingLockRef.current || pendingSendRef.current) return;
    setSendError("");
    const { items, errors } = appendAttachmentSelection(attachments, files, kind, createClientMessageId);
    setAttachments(items);
    if (errors.length) setSendError(`Не добавлено файлов: ${errors.length}. ${errors.slice(0, 3).join(' ')}${errors.length > 3 ? ' Остальные неподходящие файлы также пропущены.' : ''} Остальные выбранные файлы сохранены.`);
  }


  async function deleteMessage() {
    const socket = socketRef.current;
    if (!deleting || deleteLockRef.current) return;
    if (!socket?.connected) { setDeleteError('Нет соединения с сервером. Подождите подключения и повторите.'); return; }
    const id = deleting.id;
    deleteLockRef.current = true; setSavingDelete(true); setDeleteError('');
    try {
      const result = await new Promise<{ ok: boolean; id?: number; error?: string }>((resolve, reject) => {
        socket.timeout(15000).emit('delete-message', { id, conversationId: scope }, (error: Error | null, response: { ok: boolean; id?: number; error?: string }) => error ? reject(new Error('Сервер не подтвердил удаление. Можно повторить.')) : resolve(response));
      });
      if (!result.ok) throw new Error(result.error || 'Не удалось удалить сообщение');
      recordDeletion(id); setNotice('Сообщение удалено у всех'); requestAnimationFrame(() => composerRef.current?.focus());
    } catch (error) {
      if (deletedIdsRef.current.has(id)) { setNotice('Сообщение удалено у всех'); setDeleting(null); }
      else setDeleteError((error as Error).message);
    } finally { deleteLockRef.current = false; setSavingDelete(false); }
  }

  async function copyMessage(item: Message) {
    if (!item.text) { setNotice('В сообщении нет текста'); return; }
    try {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
        await navigator.clipboard.writeText(item.text);
      } catch {
        const area = document.createElement('textarea');
        area.value = item.text; area.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(area);
        try { area.select(); if (!document.execCommand('copy')) throw new Error('copy failed'); }
        finally { area.remove(); }
      }
      setNotice('Текст скопирован');
    } catch { setNotice('Не удалось скопировать текст. Выделите его вручную.'); }
  }

  async function jumpToMessage(id: number) {
    if (deletedIdsRef.current.has(id)) { setNotice('Исходное сообщение удалено'); return; }
    let target = document.getElementById(`message-${id}`);
    if (!target && !jumpLockRef.current) {
      jumpLockRef.current = true;
      try {
        // Fetch bounded pages of this conversation only, until the quote is loaded.
        for (let page = 0; page < 20 && !target && alive.current; page++) {
          const cursor = historyCursorRef.current;
          if (cursor === null || cursor < id || !await loadHistory(cursor)) break;
          target = document.getElementById(`message-${id}`);
        }
      } finally { jumpLockRef.current = false; }
    }
    if (!alive.current) return;
    if (!target) { setNotice('Исходное сообщение недоступно. Попробуйте загрузить предыдущие сообщения.'); return; }
    stickToBottomRef.current = false;
    target.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    target.focus({ preventScroll: true }); setHighlighted(id);
  }

  async function saveEdit(text: string) {
    const socket = socketRef.current;
    if (!editing || !socket?.connected || editLockRef.current) return;
    editLockRef.current = true; setSavingEdit(true); setSendError('');
    try {
      const result = await new Promise<{ ok: boolean; error?: string; message?: MessageEdit }>((resolve, reject) => {
        socket.timeout(15000).emit('edit-message', {
          id: editing.id, conversationId: scope, text, expectedText: editing.text, expectedEditedAt: editing.editedAt ?? null,
        }, (error: Error | null, response: { ok: boolean; error?: string; message?: MessageEdit }) => error ? reject(new Error('Сервер не подтвердил изменение. Можно повторить сохранение.')) : resolve(response));
      });
      if (!result.ok || !result.message) throw new Error(result.error || 'Не удалось изменить сообщение');
      if (deletedIdsRef.current.has(result.message.id)) { setEditing(null); setNotice('Сообщение уже удалено'); return; }
      latestEditsRef.current.set(result.message.id, result.message);
      setMessages((current) => mergeMessageHistory(current, [], latestEditsRef.current, deletedIdsRef.current));
      setEditing(null); setNotice('Сообщение изменено'); requestAnimationFrame(() => composerRef.current?.focus());
    } catch (error) { setSendError((error as Error).message); }
    finally { editLockRef.current = false; setSavingEdit(false); }
  }

  async function sendMessage() {
    const socket = socketRef.current;
    if (!socket?.connected || !user || historyError || historyLoading || editing || sendingLockRef.current ||
        (!message.trim() && !attachments.length && !pendingSendRef.current)) return;
    sendingLockRef.current = true;
    setSending(true);
    setSendError("");
    setBatchLocked(true);
    let uploadFailed = false;
    try {
      let pending = pendingSendRef.current;
      if (!pending) {
        const groups = groupAttachments(attachments);
        // Текст без вложений тоже отправляется через подтверждение сервера.
        if (!groups.length) groups.push([]);
        pending = { conversationId: scope, text: message.trim(), replyToId: replying?.id ?? null, groups: groups.map((items) => ({ items, clientMessageId: createClientMessageId() })), next: 0 };
        pendingSendRef.current = pending;
      }
      for (; pending.next < pending.groups.length; pending.next++) {
        const index = pending.next;
        let group = pending.groups[index];
        for (const [fileIndex, item] of group.items.entries()) {
          setBatchStatus(`Сообщение ${index + 1} из ${pending.groups.length} · файл ${fileIndex + 1} из ${group.items.length}: ${item.file.name}`);
          setUploadProgress(0);
          try { item.url = await uploadAttachment(item, setUploadProgress); }
          catch (error) { uploadFailed = true; throw new Error(`${item.file.name}: ${(error as Error).message}`); }
        }
        // Неподдерживаемое фото могло стать файлом. До отправки сообщения
        // разбиваем такую группу, сохраняя порядок и уже загруженные URL.
        const regrouped = groupAttachments(group.items);
        if (regrouped.length > 1) {
          pending.groups.splice(index, 1, ...regrouped.map((items, part) => ({
            items, clientMessageId: part === 0 ? group.clientMessageId : createClientMessageId(),
          })));
          group = pending.groups[index];
        }
        setBatchStatus(`Отправляем сообщение ${index + 1} из ${pending.groups.length}…`);
        const kind = group.items[0]?.kind;
        const imageUrls = kind === 'image' ? group.items.map((item) => item.url!) : [];
        const result = await new Promise<{ ok: boolean; error?: string; code?: string; deleted?: boolean; id?: number; message?: Message }>((resolve, reject) => {
          socket.timeout(15000).emit('chat-message', {
            conversationId: pending.conversationId, text: index === 0 ? pending.text : '', imageUrls, replyToId: index === 0 ? pending.replyToId : null,
            audioUrl: kind === 'audio' ? group.items[0].url : null,
            videoUrl: kind === 'video' ? group.items[0].url : null,
            documentUrl: kind === 'document' ? group.items[0].url : null,
            clientMessageId: group.clientMessageId,
          }, (error: Error | null, response: { ok: boolean; error?: string; code?: string; deleted?: boolean; id?: number; message?: Message }) => {
            if (error) reject(new Error('Сервер не подтвердил отправку. Нажмите отправить ещё раз: сохранённые сообщения не продублируются.'));
            else resolve(response);
          });
        });
        if (!scopeAccessRef.current) { pendingSendRef.current = null; setBatchLocked(false); throw new Error('Доступ к группе прекращён'); }
        if (!result.ok || (!result.message && !result.deleted)) {
          if (result.code === 'REPLY_UNAVAILABLE') { setReplying(null); uploadFailed = true; }
          if (result.code === 'ATTACHMENT_UNAVAILABLE') { for (const item of group.items) item.url = undefined; uploadFailed = true; }
          throw new Error(result.error || 'Не удалось отправить сообщение');
        }
        if (result.deleted && result.id) recordDeletion(result.id);
        else if (result.message) {
          const saved = result.message;
          receivedDuringHistory.current.set(saved.id, saved);
          setMessages((current) => mergeMessageHistory(current, [saved], latestEditsRef.current, deletedIdsRef.current));
        }
        const sentIds = new Set(group.items.map((item) => item.id));
        draftRef.current = { message: '', replying: null, attachments: draftRef.current.attachments.filter((item) => !sentIds.has(item.id)) };
        saveDraft(scope, draftRef.current);
        setAttachments((current) => current.filter((item) => !sentIds.has(item.id)));
        setMessage('');
        if (index === 0) setReplying(null);
      }
      void refreshConversations();
      pendingSendRef.current = null;
      setBatchLocked(false);
      setBatchStatus('');
    } catch (error) {
      if (uploadFailed) {
        // Текущее сообщение ещё не отправляли: можно безопасно изменить его состав.
        // Файлы с успешной загрузкой сохраняют url и не загружаются повторно.
        pendingSendRef.current = null;
        setBatchLocked(false);
      }
      setSendError(error instanceof Error ? error.message : 'Не удалось отправить сообщение');
    } finally {
      sendingLockRef.current = false;
      setSending(false);
    }
  }

  async function logout() {
    try {
      await fetch("/api/logout", {
        method: "POST",
      });
    } catch (error) {
      console.error(
        "Ошибка выхода:",
        error
      );
    } finally {
      socketRef.current?.disconnect();

      router.replace("/login");
      router.refresh();
    }
  }

  if (checkingSession || sessionError) {
    return (
      <main
        style={{
          position: "fixed",
          inset: 0,
          background: "#0d1015",
          color: "white",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
          gap: 16,
          padding: 24,
          textAlign: "center",
          fontFamily: "Arial, sans-serif",
        }}
      >
        {sessionError ? <>
          <div role="alert" style={{ maxWidth: 420, lineHeight: 1.5 }}>{sessionError}</div>
          <button type="button" onClick={() => { setSessionError(''); setCheckingSession(true); setSessionAttempt((attempt) => attempt + 1); }}
            style={{ border: 0, borderRadius: 10, padding: '12px 20px', background: '#6753dc', color: 'white', cursor: 'pointer' }}>Повторить проверку</button>
        </> : <div role="status">Проверка сессии...</div>}
      </main>
    );
  }

  if (!user) {
    return null;
  }

  const selectedConversation = conversations.find((item) => item.id === scope);
  const menuMessage = menu ? messages.find((item) => item.id === menu.id) : null;
  const galleryUrls = [...new Set(messages.flatMap((item) => item.imageUrls?.length ? item.imageUrls : item.imageUrl ? [item.imageUrl] : []))];

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        background: "#0d1015",
        color: "white",
        fontFamily: "Arial, sans-serif",
      }}
    >
      {/* Левая панель */}
      <aside className={layout.sidebar}
        style={{
          width: "250px",
          minWidth: "250px",
          background: "#171a21",
          borderRight: "1px solid #30343d",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Название */}
        <div className={layout.brand}
          style={{
            padding: "24px 20px 20px",
            fontSize: "27px",
            fontWeight: "700",
          }}
        >
          MediaChat
        </div>

        <button type="button" onClick={() => setGroupDialog('new')} style={{ margin: '0 8px 8px', padding: 10, background: '#30283f', color: '#d6caff', border: 0, borderRadius: 10 }}>Создать группу</button>
        <ConversationList items={conversations} selected={scope} onSelect={selectConversation} onStart={startConversation}
          error={conversationError} loading={conversationsLoading} onRetry={() => { void refreshConversations(); }} />

        {/* Профиль */}
        <div className={layout.profile}
          style={{
            borderTop: "1px solid #30343d",
            padding: "18px 14px",
          }}
        >
          <div className={layout.identity}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "11px",
            }}
          >
            <button type="button" aria-label="Мой профиль и аватарка" onClick={() => setOwnProfile(true)} style={{ padding: 0, background: 'none', border: 0, cursor: 'pointer' }}><Avatar name={user.username} url={user.avatarUrl} /></button>

            <div className={layout.details}
              style={{
                flex: 1,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: "700",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {user.username}
              </div>

              <div
                style={{
                  marginTop: "4px",
                  fontSize: "14px",
                  color: connected
                    ? "#5ee391"
                    : "#ff6d6d",
                }}
              >
                {connected
                  ? "В сети"
                  : "Не в сети"}
              </div>
            </div>
          </div>

          <button
            onClick={logout}
            style={{
              width: "100%",
              height: "38px",
              marginTop: "14px",
              borderRadius: "9px",
              border: "1px solid #3b404b",
              background: "#222630",
              color: "#d8d8d8",
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            Выйти
          </button>
        </div>
      </aside>

      {/* Основная область */}
      <section
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Верхняя панель */}
        <header className={layout.header}
          style={{
            height: "76px",
            minHeight: "76px",
            borderBottom:
              "1px solid #30343d",
            background: "#15181f",
            display: "flex",
            alignItems: "center",
            padding: "0 28px",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: "21px",
                fontWeight: "700",
              }}
            >
              {scope === null ? 'Общий чат' : <button type="button" onClick={() => { if (selectedConversation?.kind === 'group') setGroupDialog(scope); else { const peer = selectedConversation?.peer; if (peer) setProfile(peer); } }} style={{ display: 'flex', maxWidth: '100%', minWidth: 0, gap: 10, alignItems: 'center', background: 'none', border: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }}><Avatar name={selectedConversation?.peer.username ?? '?'} url={selectedConversation?.peer.avatarUrl} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conversations.find((item) => item.id === scope)?.peer.username ?? 'Личная переписка'}</span></button>}
            </div>

            <div
              style={{
                marginTop: "4px",
                fontSize: "14px",
                color: connected
                  ? "#949ba8"
                  : "#ff6d6d",
              }}
            >
              {selectedConversation?.kind === 'group' && <span>{selectedConversation.memberCount} участников · </span>}{connected
                ? "Соединение установлено"
                : "Нет соединения"}
            </div>
          </div>
        </header>

        {/* История сообщений */}
        <div
          className={layout.history}
          ref={messagesRef}
          tabIndex={0}
          aria-label="Сообщения чата"
          onWheelCapture={(event) => {
            lastScrollInteractionRef.current = Date.now();
            if (event.deltaY < 0) stickToBottomRef.current = false;
          }}
          onTouchMoveCapture={() => { lastScrollInteractionRef.current = Date.now(); }}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) lastScrollInteractionRef.current = Date.now();
          }}
          onKeyDownCapture={(event) => {
            if (event.target === event.currentTarget && ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
              lastScrollInteractionRef.current = Date.now();
              if (["ArrowUp", "PageUp", "Home"].includes(event.key)) stickToBottomRef.current = false;
            }
          }}
          onScroll={(event) => {
            // Изменение layout само по себе не означает, что пользователь ушёл от конца.
            if (Date.now() - lastScrollInteractionRef.current < 1000) {
              const list = event.currentTarget;
              stickToBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
            }
          }}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overflowAnchor: "none",
            padding: "30px",
          }}
        >
          <div ref={messagesContentRef} style={{ display: "flow-root" }}>
          {historyLoading && <p role="status">Загрузка сообщений…</p>}
          {historyError && <div role="alert">{historyError} <button onClick={() => { void loadHistory(); }}>Повторить</button><button onClick={() => selectConversation(null)}>Общий чат</button></div>}
          {nextCursor !== null && <button disabled={historyLoading} onClick={() => { stickToBottomRef.current = false; void loadHistory(nextCursor); }} style={{ display: 'block', margin: '0 auto 18px', border: '1px solid #464052', background: '#242935', color: '#c9baff', padding: '9px 16px', borderRadius: 10 }}>Загрузить предыдущие сообщения</button>}
          {!historyLoading && !historyError && !messages.length && <p style={{ color: '#a1a4b4', textAlign: 'center' }}>Начните переписку — отправьте первое сообщение.</p>}
          {messages.map((item) => {
            if (item.system) {
              return (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    justifyContent:
                      "flex-start",
                    marginBottom: "22px",
                  }}
                >
                  <div
                    style={{
                      background: "#272b36",
                      padding: "14px 18px",
                      borderRadius: "20px",
                      maxWidth: "65%",
                    }}
                  >
                    <div
                      style={{
                        color: "#ad91ff",
                        fontWeight: "700",
                        fontSize: "14px",
                        marginBottom: "8px",
                      }}
                    >
                      System
                    </div>

                    <div
                      style={{
                        fontSize: "17px",
                      }}
                    >
                      {item.text}
                    </div>
                  </div>
                </div>
              );
            }

            const isOwnMessage =
              item.userId === user.id;
              const imageUrls = item.imageUrls?.length ? item.imageUrls : item.imageUrl ? [item.imageUrl] : [];
              const hasImage = imageUrls.length > 0;
              const isImageOnly =hasImage && !item.text;
              const isUnframedMedia = isImageOnly || Boolean(item.videoUrl);

            return (
              <MessageActionTarget id={item.id} author={item.author} highlighted={highlighted === item.id}
                onOpen={(position) => setMenu({ id: item.id, position, token: performance.now() })}
                key={item.id}
                style={{
                  display: "flex",
                  justifyContent:
                    isOwnMessage
                      ? "flex-end"
                      : "flex-start",
                  marginBottom: "22px",
                }}
              >
                <div
                  style={{
                    maxWidth: hasImage ? "min(85%, 420px)" : "65%",
                    width: imageUrls.length > 1 ? "min(85%, 420px)" : undefined,
                    background: isUnframedMedia
                      ? "transparent"
                      : isOwnMessage
                        ? "#6753dc"
                        : "#272b36",
                    padding: isUnframedMedia ? "0" : item.audioUrl ? "8px 12px" : "14px 18px",
                    borderRadius: isUnframedMedia ? "16px" : "20px",
                  }}
                >
                  <div
                    style={{
                      fontWeight: "700",
                      fontSize: "14px",
                      marginBottom: item.videoUrl ? "6px" : "8px",
                      color: isOwnMessage
                        ? "#ffffff"
                        : "#ad91ff",
                      textAlign: isUnframedMedia && isOwnMessage
                        ? "right"
                        : "left",
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Avatar size={28} name={item.author} url={item.avatarUrl} />{item.author}</span>
                  </div>

                  {item.replyToId && (() => {
                    const original = messages.find((source) => source.id === item.replyToId);
                    const quote = original ? { id: original.id, author: original.author, preview: messagePreview(original) } : item.replyTo;
                    return <button type="button" className={actionStyles.quote} aria-label={`Перейти к исходному сообщению ${item.replyToId}`} onClick={() => jumpToMessage(item.replyToId!)}>
                      <strong>{quote?.author || 'Исходное сообщение недоступно'}</strong><span>{quote?.preview || 'Сообщение недоступно'}</span>
                    </button>;
                  })()}

                  {item.text && (
                    <div
                      style={{
                        fontSize: "17px",
                        lineHeight: "1.4",
                        wordBreak: "break-word",
                      }}
                    >
                      {item.text}
                    </div>
                  )}


                  {hasImage && (
                    <div
                      style={{
                        marginTop: item.text ? "8px" : "0",
                        maxWidth: "100%",
                        display: "flex",
                        justifyContent: item.text ? "center" : isOwnMessage ? "flex-end" : "flex-start",
                      }}
                    >
                      <MediaChatAlbum centered={Boolean(item.text)} galleryUrls={galleryUrls} urls={imageUrls} author={item.author} own={isOwnMessage} />
                    </div>
                  )}


                  {item.audioUrl && (
                    <MediaChatAudioAttachment
                      audioUrl={item.audioUrl}
                      name={item.audioName || "Аудиофайл"}
                      hasText={Boolean(item.text)}
                      onPlay={() => {
                        flushSync(() => { activeAudioIdRef.current = item.id; setActiveAudio({ id: item.id, url: item.audioUrl! }); });
                        audioPlayerRef.current?.play();
                      }}
                    />
                  )}


                  {item.video && <MediaChatVideo key={item.video.url} video={item.video} onOpen={() => audioPlayerRef.current?.pause()} />}
                  {item.videoUrl && !item.video && <span style={{ fontSize: 13 }}>Видео недоступно</span>}

                  {item.document && <MediaChatDocument document={item.document} />}
                  {item.documentUrl && !item.document && <span style={{ fontSize: 13 }}>Документ недоступен</span>}

                  {item.createdAt && (
                    <div
                      style={{
                        marginTop: "8px",
                        fontSize: "11px",
                        opacity: 0.65,
                        textAlign: "right",
                      }}
                    >
                      {formatMessageDate(item.createdAt)}{item.editedAt && <span> · изменено</span>}
                    </div>
                  )}
                </div>
              </MessageActionTarget>
            );
          })}
          </div>
        </div>

        {/* Поле отправки: текст, выбор картинки и предпросмотр */}
        <footer className={layout.composer}
          style={{
            flexShrink: 0,
            borderTop: "1px solid #30343d",
            background: "#15181f",
            padding: "14px 20px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >

          {activeAudio && (
            <MediaChatAudio
              key={activeAudio.id}
              audioUrl={activeAudio.url}
              ref={audioPlayerRef}
              title={messages.find((item) => item.id === activeAudio.id)?.audioName || "Аудиофайл"}
              subtitle={`Отправил: ${messages.find((item) => item.id === activeAudio.id)?.author ?? "участник чата"}`}
              onClose={() => { activeAudioIdRef.current = null; setActiveAudio(null); }}
            />
          )}

          {editing && <MessageEditForm key={editing.id} text={editing.text} allowEmpty={hasMessageAttachments(editing)} busy={savingEdit} onSave={saveEdit} onCancel={() => { setEditing(null); setSendError(''); requestAnimationFrame(() => composerRef.current?.focus()); }} />}
          {replying && !editing && <div className={actionStyles.composerCard} aria-label="Ответ на сообщение">
            <button type="button" className={actionStyles.quote} onClick={() => jumpToMessage(replying.id)}>
              <strong>{(messages.find((item) => item.id === replying.id) || replying).author}</strong>
              <span>{messagePreview(messages.find((item) => item.id === replying.id) || replying)}</span>
            </button>
            <button type="button" className={actionStyles.cancel} disabled={sending || batchLocked} aria-label="Отменить ответ" onClick={() => { setReplying(null); requestAnimationFrame(() => composerRef.current?.focus()); }}><X size={18} /></button>
          </div>}
          <AttachmentDraft items={attachments} disabled={sending || batchLocked} onRemove={(id) => setAttachments((current) => current.filter((item) => item.id !== id))} />
          {sending && <div role="status" style={{ fontSize: 12, color: '#c7c0e4' }}>
            {batchStatus}
            <progress max={100} value={uploadProgress} aria-label="Загрузка вложений" style={{ width: '100%', accentColor: '#6753dc' }} />
          </div>}
          {batchLocked && !sending && <button type="button" onClick={() => {
            pendingSendRef.current = null; setAttachments([]); setMessage(''); setReplying(null); setSendError(''); setBatchLocked(false); setBatchStatus('');
          }} style={{ background: 'transparent', color: '#b8afd9', border: 0, cursor: 'pointer', textAlign: 'left', fontSize: 12 }}>
            Убрать оставшиеся файлы (уже отправленные останутся в чате)
          </button>}

          {sendError && (
            <div role="alert" style={{ color: "#ff8585", fontSize: "13px" }}>
              {sendError}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <AttachmentMenu disabled={!connected || sending || batchLocked || Boolean(editing)}
              onImage={(files) => selectAttachments(files, 'image')}
              onAudio={(files) => selectAttachments(files, 'audio')}
              onVideo={(files) => selectAttachments(files, 'video')}
              onDocument={(files) => selectAttachments(files, 'document')} />

            <input
              ref={composerRef}
              value={message}
              maxLength={4000}
              onChange={(event) => setMessage(event.target.value)}
              readOnly={batchLocked}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  sendMessage();
                }
              }}
              disabled={sending || Boolean(editing)}
              placeholder="Написать сообщение..."
              style={{
                flex: 1,
                minWidth: 0,
                height: "48px",
                padding: "0 16px",
                border: "1px solid #3a3f4a",
                borderRadius: "12px",
                background: "#222630",
                color: "white",
                fontSize: "16px",
                outline: "none",
              }}
            />

            <button
              type="button"
              onClick={sendMessage}
              disabled={
              !connected || historyLoading || Boolean(historyError) ||
              Boolean(editing) ||
              sending ||
              (!message.trim() && !attachments.length && !batchLocked)
            }
              title="Отправить"
              aria-label="Отправить сообщение"
              style={{
                width: "54px",
                height: "48px",
                flexShrink: 0,
                border: "none",
                borderRadius: "12px",
                background: connected && !sending ? "#6d56ec" : "#343843",
                color: "white",
                fontSize: "22px",
                cursor: connected && !sending ? "pointer" : "default",
              }}
            >
              {sending ? "…" : "➤"}
            </button>
          </div>
        </footer>
      </section>
      {ownProfile && <OwnProfile user={user} onClose={() => setOwnProfile(false)} onSaved={(url) => { setUser((current) => current ? { ...current, avatarUrl: url } : current); }} />}
      {groupDialog !== null && <GroupDialog id={groupDialog === 'new' ? undefined : groupDialog} onClose={() => setGroupDialog(null)} onCreated={(id) => { selectConversation(id); }} onChanged={() => { void refreshConversations(); }} />}
      {profile && <PeerProfile peer={profile} onClose={() => setProfile(null)} onStart={startConversation} />}
      {deleting && <MessageDeleteDialog busy={savingDelete} error={deleteError} onConfirm={deleteMessage} onCancel={() => { setDeleting(null); setDeleteError(''); }} />}
      {notice && <div role="status" className={actionStyles.toast}>{notice}</div>}
      {menu && menuMessage && <MessageActionsMenu key={menu.token} position={menu.position}
        canDelete={menuMessage.userId === user.id} canCopy={Boolean(menuMessage.text)} canEdit={menuMessage.userId === user.id && canEditMessageText(menuMessage)} onClose={closeMenu}
        onCopy={() => { void copyMessage(menuMessage); }}
        onDelete={() => {
          if (sending || savingEdit || savingDelete) { setNotice('Дождитесь завершения текущей операции'); return; }
          setDeleting(menuMessage); setDeleteError('');
        }}
        onReply={() => {
          if (sending || batchLocked || savingEdit) { setNotice('Сначала завершите текущую отправку'); return; }
          setEditing(null); setReplying(menuMessage); setSendError(''); requestAnimationFrame(() => composerRef.current?.focus());
        }}
        onEdit={() => {
          if (sending || batchLocked || savingEdit) { setNotice('Сначала завершите текущую отправку'); return; }
          setEditing(menuMessage); setSendError('');
        }} />}
    </main>
  );
}
