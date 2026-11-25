import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messagePreview, isTextOnly, canEditMessageText, hasMessageAttachments, summarizeReply, parseMessageId, sameConversation, messageRoom, nextEditMillis } from '../src/lib/message-actions.ts';
import { mergeMessageHistory } from '../src/lib/message-merge.ts';

test('reply previews and edit eligibility cover text, albums and every attachment kind', () => {
  assert.equal(messagePreview({ text: 'hello\n world' }), 'hello world');
  assert.equal(messagePreview({ text: 'x'.repeat(4000) }).length, 180);
  assert.equal(messagePreview({ imageUrls: ['a', 'b'] }), 'Альбом · 2 фото');
  for (const [field, preview] of [['imageUrl', 'Изображение'], ['audioUrl', 'Аудиофайл'], ['videoUrl', 'Видео'], ['documentUrl', 'Файл']]) {
    assert.equal(messagePreview({ [field]: '/fixture' }), preview);
    assert.equal(isTextOnly({ text: 'caption', [field]: '/fixture' }), false);
  }
  assert(isTextOnly({ text: 'only text' }));
  assert(!isTextOnly({ text: '' })); assert(!isTextOnly({ text: 'caption', images: [{}] }));
});

test('reply serialization never reveals another conversation and IDs are strictly numeric', () => {
  const original = { id: 1, text: 'private', userId: 1, conversationId: 3, user: { username: 'author' } };
  assert.equal(summarizeReply(original, null), null);
  assert.equal(summarizeReply(original, 4), null);
  assert.deepEqual(summarizeReply(original, 3), { id: 1, author: 'author', preview: 'private', editedAt: null });
  assert(sameConversation(undefined, null)); assert(!sameConversation(1, null));
  assert.equal(messageRoom(null), 'general'); assert.equal(messageRoom(3), 'conversation:3');
  assert.equal(parseMessageId(1), 1);
  for (const value of [0, -1, 1.5, '1', null, {}, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => parseMessageId(value));
});

test('late history and send acknowledgements cannot roll back realtime edits or duplicate messages', () => {
  const old = { id: 1, text: 'before', editedAt: null as string | null };
  const edited = { id: 1, text: 'after', editedAt: '2026-11-12T10:00:00Z' };
  assert.deepEqual(mergeMessageHistory([edited], [old, old]), [edited]);
  const cache = new Map([[1, edited]]);
  assert.deepEqual(mergeMessageHistory([], [old], cache), [edited]);
  const newest = { id: 1, text: 'newest', editedAt: '2026-11-12T10:00:01Z' };
  assert.deepEqual(mergeMessageHistory([newest], [old], cache), [newest]);
});


test('edit timestamps remain strictly increasing for rapid changes and clock rollback', () => {
  const old = '2026-11-12T10:00:00.000Z';
  const ms = Date.parse(old);
  assert.equal(nextEditMillis(old, ms), ms + 1);
  assert.equal(nextEditMillis(old, ms - 1000), ms + 1);
  assert.equal(nextEditMillis(null, ms), ms);
});


test('own-message text editing supports attachment captions, including adding/removing a caption', () => {
  for (const source of [{ imageUrl: '/image' }, { imageUrls: ['a', 'b'] }, { images: [{}] }, { audioUrl: '/audio' }, { videoUrl: '/video' }, { documentUrl: '/file' }]) {
    assert(hasMessageAttachments(source));
    assert(canEditMessageText({ ...source, text: '' }));
    assert(canEditMessageText({ ...source, text: 'caption' }));
    assert(!canEditMessageText({ ...source, text: 'caption', deletedAt: {} }));
  }
  assert(canEditMessageText({ text: 'text only' }));
  assert(!canEditMessageText({ text: '' }));
  assert(!canEditMessageText({ text: '   ' }));
});


test('off-page quotes update on edits, survive late history and preserve newer server previews', () => {
  const time = '2026-11-17T10:00:00Z';
  const reply = { id: 200, text: 'reply', replyToId: 1, replyTo: { id: 1, author: 'Alice', preview: 'old', editedAt: null as string | null } };
  const edits = new Map([[1, { id: 1, text: '', editedAt: time, replyPreview: 'Изображение' }]]);
  const updated = mergeMessageHistory([reply], [], edits);
  assert.equal(updated[0].replyTo?.preview, 'Изображение');
  assert.equal(updated[0].replyTo?.author, 'Alice');
  assert.equal(mergeMessageHistory(updated, [reply], edits)[0].replyTo?.preview, 'Изображение');
  const newer = { ...reply, replyTo: { ...reply.replyTo, preview: 'new caption', editedAt: '2026-11-17T10:01:00Z' } };
  assert.equal(mergeMessageHistory([], [newer], edits)[0].replyTo?.preview, 'new caption');
  assert.equal(mergeMessageHistory(updated, [], edits, new Set([1]))[0].replyTo?.author, 'Сообщение удалено');
});
