import { allowedOrigins, permittedOrigin } from "./src/lib/origin-policy.ts";
import { setProfilePublisher, sweepUnusedAvatars } from "./src/lib/avatar-storage.ts";
import { conversationResource } from "./src/lib/groups.ts";
import { conversationId, canAccessConversation, assertAttachmentScope, setConversationPublisher } from "./src/lib/conversations.ts";
import { lockResources, mediaResource, messageResource } from "./src/lib/media-locks.ts";
import { processCleanupJobs, sweepOrphanMedia } from "./src/lib/media-cleanup.ts";
import { parseMessageId, sameConversation, summarizeReply, messagePreview, canEditMessageText, hasMessageAttachments, messageRoom, nextEditMillis } from "./src/lib/message-actions.ts";
import { normalizeImageUrls, storedImageUrls } from "./src/lib/image-albums.ts";
import { assertOwnedVideo, getVideoInfo } from "./src/lib/video-storage.ts";
import { assertOwnedDocument, getDocumentInfo } from "./src/lib/document-storage.ts";
import { assertOwnedMedia } from "./src/lib/owned-media.ts";
import { consumeLimit } from "./src/lib/rate-limit.ts";
import { getAudioOriginalName } from "./src/lib/audio-metadata.ts";
import "dotenv/config";

import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import { jwtVerify } from "jose";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({
  dev,
  hostname,
  port,
});

const handle = app.getRequestHandler();

function getCookie(cookieHeader, name) {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split("=");

    if (key === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return null;
}

app
  .prepare()
  .then(async () => {
    const { db } = await import("./src/prisma/db.ts");

    const secret = process.env.SESSION_SECRET;

    if (!secret) {
      throw new Error("SESSION_SECRET не задан");
    }

    const sessionSecret = new TextEncoder().encode(secret);

    console.log("База данных подключена");

    const httpServer = createServer((req, res) => {
      req.headers["x-mediachat-client-ip"] = req.socket.remoteAddress || "unknown";
      handle(req, res);
    });

    // Для потоковой загрузки документов до 2 ГБ; маршрут ограничивает время отдельно.
    httpServer.requestTimeout = 61 * 60_000;

    const io = new Server(httpServer, {
      allowRequest(req, callback) {
        const origin = req.headers.origin;
        try {
          const allowed = allowedOrigins();
          const host = req.headers.host;
          callback(null, origin ? permittedOrigin(origin, host, allowed) : Boolean(host && [...allowed].some((value) => new URL(value).host === host)));
        } catch { callback(null, false); }
      },
      transports: ["polling", "websocket"],
    });

    setProfilePublisher((profile) => io.emit('profile-updated', profile));
    setConversationPublisher(async (userIds, id) => {
      const members = await db.orm.public.ConversationMember.where({ conversationId: id }).select('userId').all();
      const live = await db.orm.public.Conversation.where({ id, deletedAt: null }).select('id').first();
      const active = new Set(live ? members.map((m) => m.userId) : []);
      for (const userId of userIds) {
        const room = `user:${userId}`;
        if (active.has(userId)) io.in(room).socketsJoin(messageRoom(id));
        else { io.in(room).socketsLeave(messageRoom(id)); io.to(room).emit('conversation-revoked', { conversationId: id }); }
      }
      io.to(userIds.map((id) => `user:${id}`)).emit('conversations-changed', { conversationId: id });
    });
    async function emitConversation(scope, event, payload, exceptSocket) {
      if (scope === null) { const target = exceptSocket ? io.except(exceptSocket) : io; target.to('general').emit(event, payload); return; }
      await db.transaction(async (tx) => {
        // Check and enqueue under the same lock as membership changes. Otherwise
        // removal could commit between selecting recipients and emitting data.
        await lockResources(tx, [conversationResource(scope)]);
        const live = await tx.orm.public.Conversation.where({ id: scope, deletedAt: null }).select('id').first();
        if (!live) return;
        const members = await tx.orm.public.ConversationMember.where({ conversationId: scope }).select('userId').all();
        const target = exceptSocket ? io.except(exceptSocket) : io;
        target.to(members.map((m) => `user:${m.userId}`)).emit(event, payload);
      });
    }

    io.use(async (socket, next) => {
      try {
        const cookieHeader = socket.handshake.headers.cookie;

        const token = getCookie(
          cookieHeader,
          "mediachat_session"
        );

        if (!token) {
          return next(
            new Error("Необходимо войти в аккаунт")
          );
        }

        const { payload } = await jwtVerify(
          token,
          sessionSecret,
          { algorithms: ["HS256"] }
        );

        if (typeof payload.exp !== "number") throw new Error("Сессия без срока действия");
        socket.data.expiresAt = payload.exp * 1000;
        const userId = Number(payload.userId);

        if (!Number.isInteger(userId) || userId <= 0) {
          return next(
            new Error("Недействительная сессия")
          );
        }

        const user = await db.orm.public.User
          .where({ id: userId })
          .first();

        if (!user) {
          return next(
            new Error("Пользователь не найден")
          );
        }

        socket.data.user = {
          id: user.id,
          username: user.username,
        };

        next();
      } catch (error) {
        console.error(
          "Ошибка авторизации Socket.IO:",
          error
        );

        next(
          new Error("Недействительная или истёкшая сессия")
        );
      }
    });

    io.on("connection", (socket) => {
      const user = socket.data.user;
      socket.join("general");
      socket.join(`user:${user.id}`);
      // Rejoin every authorized conversation on every connection, across devices.
      void db.orm.public.ConversationMember.where({ userId: user.id }).select('conversationId').all()
        .then((members) => { if (socket.connected) for (const member of members) socket.join(messageRoom(member.conversationId)); })
        .catch((error) => { console.error('Подписки переписок:', error); socket.disconnect(true); });
      socket.on('subscribe-conversation', async (incoming, acknowledge) => {
        try {
          const id = conversationId(incoming?.conversationId);
          if (consumeLimit(`subscribe:${user.id}`, 120, 60_000)) throw new Error('Слишком много подписок');
          if (Date.now() >= socket.data.expiresAt || !await canAccessConversation(user.id, id)) throw new Error('Переписка недоступна');
          await socket.join(messageRoom(id));
          if (typeof acknowledge === 'function') acknowledge({ ok: true });
        } catch { if (typeof acknowledge === 'function') acknowledge({ ok: false, error: 'Переписка недоступна' }); }
      });
      const expiryTimer = setTimeout(() => socket.disconnect(true),
        Math.max(0, Math.min(socket.data.expiresAt - Date.now(), 2_147_483_647)));
      expiryTimer.unref();
      socket.on("disconnect", () => clearTimeout(expiryTimer));

      console.log(
        `Пользователь подключился: ${user.username} (id: ${user.id})`
      );

      socket.on("chat-message", async (incoming, acknowledge) => {
        const reply = (result) => {
          if (typeof acknowledge === "function") {
            acknowledge(result);
          }
        };

        try {
          if (Date.now() >= socket.data.expiresAt) {
            reply({ ok: false, error: "Сессия истекла. Войдите снова." });
            socket.disconnect(true);
            return;
          }
          if (consumeLimit(`message:${user.id}`, 60, 60_000)) {
            reply({ ok: false, error: "Слишком много сообщений. Подождите минуту." });
            return;
          }
          const scope = conversationId(incoming?.conversationId);
          if (!await canAccessConversation(user.id, scope)) { reply({ ok: false, error: 'Переписка недоступна' }); return; }
          const existingUser = await db.orm.public.User.where({ id: user.id }).first();
          if (!existingUser) {
            reply({ ok: false, error: "Пользователь не найден" });
            socket.disconnect(true);
            return;
          }
          const text =
            typeof incoming?.text === "string"
              ? incoming.text.trim()
              : "";

          let imageUrls;
          try { imageUrls = normalizeImageUrls(incoming?.imageUrls, incoming?.imageUrl); }
          catch (error) { reply({ ok: false, error: error.message }); return; }
          const imageUrl = imageUrls[0] ?? null;

            const audioUrl =
              typeof incoming?.audioUrl === "string"
                ? incoming.audioUrl.trim() || null
                : null;


          const documentUrl = typeof incoming?.documentUrl === "string" ? incoming.documentUrl.trim() || null : null;
          const videoUrl = typeof incoming?.videoUrl === "string" ? incoming.videoUrl.trim() || null : null;
          const replyToId = incoming?.replyToId == null ? null : parseMessageId(incoming.replyToId);
          let replyTarget = null;
          const nonce = incoming?.clientMessageId;
          if (nonce != null && (typeof nonce !== "string" || !/^[0-9a-f-]{36}$/i.test(nonce))) {
            reply({ ok: false, error: "Некорректный идентификатор сообщения" });
            return;
          }
          const clientMessageId = nonce ? `${user.id}:${nonce}` : null;
          let savedMessage = clientMessageId ? await db.orm.public.Message.where({ clientMessageId }).first() : null;
          if (savedMessage?.deletedAt && sameConversation(savedMessage.conversationId, scope)) {
            reply({ ok: true, deleted: true, id: savedMessage.id }); return;
          }
          if (!text && !imageUrl && !audioUrl && !documentUrl && !videoUrl) {
            reply({ ok: false, error: "Пустое сообщение" });
            return;
          }

          if ([imageUrl, audioUrl, documentUrl, videoUrl].filter(Boolean).length > 1) {
            reply({
              ok: false,
              error: "Разрешено одно вложение в сообщении",
            });
            return;
          }

          if (text.length > 4000) {
            reply({ ok: false, error: "Слишком длинное сообщение" });
            return;
          }

          let replay = Boolean(savedMessage);
          if (!savedMessage) {
            try {
              savedMessage = await db.transaction(async (tx) => {
                await lockResources(tx, [...imageUrls, audioUrl, documentUrl, videoUrl].filter(Boolean).map(mediaResource).concat(scope === null ? [] : [conversationResource(scope)])
                  .concat(replyToId === null ? [] : [messageResource(replyToId)]));
                if (!await canAccessConversation(user.id, scope, tx)) throw new Error('Переписка недоступна');
                if (replyToId !== null) {
                  replyTarget = await tx.orm.public.Message.where({ id: replyToId }).include('user', (author) => author.select('id', 'username')).first();
                  if (!replyTarget || replyTarget.deletedAt || !sameConversation(replyTarget.conversationId, scope)) {
                    const error = new Error('Исходное сообщение недоступно в этом чате'); error.code = 'REPLY_UNAVAILABLE'; throw error;
                  }
                }
                try {
                  for (const url of imageUrls) await assertOwnedMedia(url, user.id, 'image');
                  if (audioUrl) await assertOwnedMedia(audioUrl, user.id, 'audio');
                  if (documentUrl) await assertOwnedDocument(documentUrl, user.id);
                  if (videoUrl) await assertOwnedVideo(videoUrl, user.id);
                  await assertAttachmentScope(tx, [...imageUrls, audioUrl, documentUrl, videoUrl].filter(Boolean), scope);
                } catch {
                  const error = new Error('Вложение недоступно или не принадлежит вам'); error.code = 'ATTACHMENT_UNAVAILABLE'; throw error;
                }
                const saved = await tx.orm.public.Message.create({
                  text, imageUrl, audioUrl, documentUrl, videoUrl, clientMessageId, replyToId, userId: user.id, conversationId: scope,
                });
                for (const [position, url] of imageUrls.entries()) {
                  await tx.orm.public.MessageImage.create({ messageId: saved.id, imageUrl: url, position });
                }
                return saved;
              });
            } catch (error) {
              // Уникальный ключ защищает также от двух одновременных retry.
              savedMessage = clientMessageId ? await db.orm.public.Message.where({ clientMessageId }).first() : null;
              if (!savedMessage) throw error;
              replay = true;
            }
          }
          if (savedMessage.deletedAt) {
            if (!sameConversation(savedMessage.conversationId, scope)) { reply({ ok: false, error: 'Идентификатор отправки относится к другой переписке' }); return; }
            reply({ ok: true, deleted: true, id: savedMessage.id }); return;
          }
          if (replay && replyToId !== null) replyTarget = await db.orm.public.Message.where({ id: replyToId }).include('user', (author) => author.select('id', 'username')).first();
          const images = await db.orm.public.MessageImage.where({ messageId: savedMessage.id }).all();
          const savedImageUrls = storedImageUrls(images, savedMessage.imageUrl);
          if (JSON.stringify(savedImageUrls) !== JSON.stringify(imageUrls) || savedMessage.userId !== user.id || !sameConversation(savedMessage.conversationId, scope) ||
              savedMessage.replyToId !== replyToId || (!savedMessage.editedAt && savedMessage.text !== text) || savedMessage.imageUrl !== imageUrl ||
              savedMessage.audioUrl !== audioUrl || savedMessage.documentUrl !== documentUrl || savedMessage.videoUrl !== videoUrl) {
            reply({ ok: false, error: "Идентификатор отправки уже использован другим сообщением" });
            return;
          }

          const outgoingMessage = {
            id: savedMessage.id,
            conversationId: savedMessage.conversationId,
            author: user.username,
            userId: user.id,
            avatarUrl: existingUser.avatarUrl,
            text: savedMessage.text,
            editedAt: savedMessage.editedAt?.toString() ?? null,
            replyToId: savedMessage.replyToId,
            replyTo: summarizeReply(replyTarget, savedMessage.conversationId),
            imageUrl: savedMessage.imageUrl,
            imageUrls: savedImageUrls,
            audioUrl: savedMessage.audioUrl,
            audioName: await getAudioOriginalName(savedMessage.audioUrl),
            documentUrl: savedMessage.documentUrl,
            document: await getDocumentInfo(savedMessage.documentUrl),
            videoUrl: savedMessage.videoUrl,
            video: await getVideoInfo(savedMessage.videoUrl),
            createdAt: savedMessage.createdAt.toString(),
          };

          if (!replay) await emitConversation(scope, "chat-message", outgoingMessage, socket.id);

          reply({
            ok: true,
            message: outgoingMessage,
          });
        } catch (error) {
          console.error("Ошибка сохранения сообщения:", error);

          reply({
            ok: false,
            error: error.code === "REPLY_UNAVAILABLE" || error.code === "ATTACHMENT_UNAVAILABLE" ? error.message : "Не удалось сохранить сообщение",
            code: error.code,
          });
        }
      });

      socket.on("edit-message", async (incoming, acknowledge) => {
        const reply = (result) => { if (typeof acknowledge === 'function') acknowledge(result); };
        try {
          if (Date.now() >= socket.data.expiresAt) {
            reply({ ok: false, error: 'Сессия истекла. Войдите снова.' }); socket.disconnect(true); return;
          }
          if (consumeLimit(`edit:${user.id}`, 30, 60_000)) {
            reply({ ok: false, error: 'Слишком много изменений. Подождите минуту.' }); return;
          }
          const scope = conversationId(incoming?.conversationId);
          if (!await canAccessConversation(user.id, scope)) { reply({ ok: false, error: 'Переписка недоступна' }); return; }
          if (!await db.orm.public.User.where({ id: user.id }).select('id').first()) {
            reply({ ok: false, error: 'Пользователь не найден' }); socket.disconnect(true); return;
          }
          const id = parseMessageId(incoming?.id);
          const result = await db.transaction(async (tx) => {
            // The experimental ORM's update lane may select before updating.
            // Serialize read/check/write with deletion and all other edits.
            await lockResources(tx, [messageResource(id), ...(scope === null ? [] : [conversationResource(scope)])]);
            if (!await canAccessConversation(user.id, scope, tx)) throw new Error('Переписка недоступна');
            const rejectEdit = (message) => { const error = new Error(message); error.code = 'EDIT_REJECTED'; throw error; };
            const target = await tx.orm.public.Message.where({ id }).include('images').first();
            if (!target || target.deletedAt || !sameConversation(target.conversationId, scope) || target.userId !== user.id || !canEditMessageText(target)) {
              rejectEdit('Изменять текст можно только у своих сообщений в этом чате');
            }
            const text = typeof incoming?.text === 'string' ? incoming.text.trim() : '';
            if (typeof incoming?.text !== 'string' || text.length > 4000 || (!text && !hasMessageAttachments(target))) {
              rejectEdit('Текст должен быть до 4000 символов. Сообщение без вложений не может быть пустым.');
            }
            // Retrying an acknowledged or lost ACK is idempotent.
            if (target.text === text) return { changed: false, message: { id, conversationId: scope, text: target.text, replyPreview: messagePreview(target), editedAt: target.editedAt?.toString() ?? null } };
            if (typeof incoming?.expectedText !== 'string' || target.text !== incoming.expectedText ||
                (target.editedAt?.toString() ?? null) !== (incoming.expectedEditedAt ?? null)) {
              rejectEdit('Сообщение уже изменено. Откройте редактирование заново.');
            }
            const updated = await tx.orm.public.Message.where({ id, userId: user.id, conversationId: scope, deletedAt: null,
              text: target.text, editedAt: target.editedAt,
            }).update({ text, editedAt: Temporal.Instant.fromEpochMilliseconds(nextEditMillis(target.editedAt?.toString() ?? null)) });
            if (!updated) rejectEdit('Сообщение уже изменено. Откройте редактирование заново.');
            return { changed: true, message: { id, conversationId: scope, text: updated.text, replyPreview: messagePreview({ ...target, text: updated.text }), editedAt: updated.editedAt.toString() } };
          });
          if (result.changed) await emitConversation(scope, 'message-edited', result.message);
          reply({ ok: true, message: result.message });
        } catch (error) {
          if (error.code !== 'EDIT_REJECTED') console.error('Ошибка редактирования сообщения:', error);
          reply({ ok: false, error: error.code === 'EDIT_REJECTED' ? error.message : 'Не удалось изменить сообщение' });
        }
      });

      socket.on('delete-message', async (incoming, acknowledge) => {
        const reply = (result) => { if (typeof acknowledge === 'function') acknowledge(result); };
        try {
          if (Date.now() >= socket.data.expiresAt) { reply({ ok: false, error: 'Сессия истекла' }); socket.disconnect(true); return; }
          if (consumeLimit(`delete:${user.id}`, 30, 60_000)) { reply({ ok: false, error: 'Слишком много удалений. Подождите минуту.' }); return; }
          const scope = conversationId(incoming?.conversationId);
          if (!await canAccessConversation(user.id, scope)) { reply({ ok: false, error: 'Переписка недоступна' }); return; }
          if (!await db.orm.public.User.where({ id: user.id }).select('id').first()) { reply({ ok: false, error: 'Пользователь не найден' }); socket.disconnect(true); return; }
          const id = parseMessageId(incoming?.id);
          const result = await db.transaction(async (tx) => {
            await lockResources(tx, [messageResource(id), ...(scope === null ? [] : [conversationResource(scope)])]);
            if (!await canAccessConversation(user.id, scope, tx)) throw new Error('Переписка недоступна');
            const target = await tx.orm.public.Message.where({ id }).include('images').first();
            if (!target || target.userId !== user.id || !sameConversation(target.conversationId, scope)) { const error = new Error('Удалять можно только свои сообщения в этом чате'); error.code = 'DELETE_FORBIDDEN'; throw error; }
            if (target.deletedAt) return { id, replay: true, urls: [], conversationId: target.conversationId };
            const urls = [...new Set([target.imageUrl, target.audioUrl, target.videoUrl, target.documentUrl, ...target.images.map((image) => image.imageUrl)].filter(Boolean))];
            await tx.orm.public.Message.where({ id, userId: user.id, deletedAt: null }).update({
              deletedAt: Temporal.Instant.fromEpochMilliseconds(Date.now()), text: '', imageUrl: null, audioUrl: null,
              videoUrl: null, documentUrl: null, editedAt: null, replyToId: null,
            });
            await tx.orm.public.MessageImage.where({ messageId: id }).delete();
            for (const url of urls) await tx.orm.public.MediaCleanupJob.upsert({ create: { url, ownerId: user.id }, update: { url, ownerId: user.id }, conflictOn: { url } });
            return { id, replay: false, urls, conversationId: target.conversationId };
          });
          if (!result.replay) await emitConversation(scope, 'message-deleted', { id, conversationId: scope });
          // Оригинал/производные удаляются после commit; сбой остаётся в durable queue.
          try { await processCleanupJobs(result.urls); } catch (error) { console.error('Очистка после удаления будет повторена:', error); }
          reply({ ok: true, id });
        } catch (error) { if (error.code !== 'DELETE_FORBIDDEN') console.error('Ошибка удаления сообщения:', error); reply({ ok: false, error: error.code === 'DELETE_FORBIDDEN' ? error.message : 'Не удалось удалить сообщение' }); }
      });

      socket.on("disconnect", () => {
        console.log(
          `Пользователь отключился: ${user.username}`
        );
      });
    });

    if (process.env.MEDIA_CLEANUP_ENABLED !== 'false') {
      let busy = false;
      let sweepPending = false;
      const run = async (sweep = false) => {
        sweepPending ||= sweep;
        if (busy) return; busy = true;
        try { await processCleanupJobs(); if (sweepPending) { sweepPending = false; await sweepOrphanMedia({ apply: true }); await sweepUnusedAvatars(); } }
        catch (error) { console.error('Фоновая очистка будет повторена:', error); }
        finally { busy = false; }
      };
      void run();
      const queueTimer = setInterval(() => { void run(); }, 60_000); queueTimer.unref();
      const sweepTimer = setInterval(() => { void run(true); }, 60 * 60_000); sweepTimer.unref();
    }

    httpServer.listen(port, hostname, () => {
      console.log(
        `MediaChat: http://localhost:${port}`
      );
    });
  })
  .catch((error) => {
    console.error(
      "Не удалось запустить MediaChat:",
      error
    );

    process.exit(1);
  });
