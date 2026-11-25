import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaFiles } from '../src/lib/media-cleanup.ts';
import { mergeMessageHistory } from '../src/lib/message-merge.ts';
import { messagePreview, summarizeReply, isTextOnly } from '../src/lib/message-actions.ts';

test('media cleanup resolves only canonical app paths, including derived files', () => {
  const id = '12345678-1234-4234-8234-123456789abc', root = '/private/tmp/safe-root';
  const image = mediaFiles(`/api/images/${id}.png`, root)!;
  assert.deepEqual(image.files, [`${root}/${id}.png`, `${root}/previews/${id}.webp`, `${root}/metadata/${id}.json`]);
  assert.equal(mediaFiles(`/api/videos/${id}.mp4`, root)?.files[1], `${root}/videos/posters/${id}.jpg`);
  assert.equal(mediaFiles(`/api/documents/${id}.bin`, root)?.files.length, 2);
  for (const url of ['/etc/passwd', '/api/images/../../secret.png', `/api/documents/${id}.bin/../secret`, `/api/videos/${id}.mp4?path=../x`, `/api/images/${id}.svg`]) assert.equal(mediaFiles(url, root), null);
});

test('deleted messages never return from late history/acks/edits; reply text is cleared', () => {
  const original = { id: 1, text: 'secret', editedAt: null, replyToId: null, replyTo: null };
  const reply = { id: 2, text: 'answer', editedAt: null, replyToId: 1, replyTo: { id: 1, author: 'author', preview: 'secret' } };
  const deleted = new Set([1]);
  const edits = new Map([[1, { id: 1, text: 'late edit', editedAt: '2026-11-12T10:00:00Z' }]]);
  const merged = mergeMessageHistory([original, reply], [original], edits, deleted);
  assert.equal(merged.length, 1); assert.equal(merged[0].id, 2);
  assert.equal(JSON.stringify(merged).includes('secret'), false);
  assert.equal(merged[0].replyTo?.author, 'Сообщение удалено');
});

test('deleted source previews do not disclose text/author or become editable', () => {
  const source = { id: 1, text: 'secret', userId: 1, conversationId: null, deletedAt: {}, user: { username: 'author' } };
  assert.equal(messagePreview(source), 'Сообщение удалено');
  assert.equal(isTextOnly(source), false);
  assert.deepEqual(summarizeReply(source, null), { id: 1, author: 'Сообщение удалено', preview: '' });
});
