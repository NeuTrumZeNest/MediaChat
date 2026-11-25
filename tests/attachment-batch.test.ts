import { UploadHttpError } from "../src/lib/upload-error.ts";
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeImageUrls, storedImageUrls } from '../src/lib/image-albums.ts';
import { groupAttachments, validateAttachmentSelection, partitionAttachmentSelection, appendAttachmentSelection, canFallbackToFile, attachmentKindForFile } from '../src/lib/attachment-batch.ts';
const urls = Array.from({ length: 10 }, (_, i) => `/api/images/00000000-0000-4000-8000-${String(i).padStart(12, '0')}.png`);

test('albums accept at most nine distinct URLs and preserve legacy messages', () => {
  assert.deepEqual(normalizeImageUrls(undefined, urls[0]), [urls[0]]);
  assert.deepEqual(normalizeImageUrls([], null), []);
  assert.deepEqual(normalizeImageUrls(urls.slice(0, 9), urls[0]), urls.slice(0, 9));
  for (const invalid of [urls, [urls[0], urls[0]], ['/etc/passwd'], [null], 'url', null]) {
    assert.throws(() => normalizeImageUrls(invalid, undefined));
  }
  assert.throws(() => normalizeImageUrls([urls[0]], urls[1]));
  assert.deepEqual(storedImageUrls([{ imageUrl: urls[1], position: 1 }, { imageUrl: urls[0], position: 0 }], null), urls.slice(0, 2));
  assert.deepEqual(storedImageUrls([], urls[0]), [urls[0]]);
});

test('batch grouping preserves order: 10 -> 9+1, 30 -> 9+9+9+3; tracks/videos stay separate', () => {
  for (const [count, lengths] of [[10, [9, 1]], [30, [9, 9, 9, 3]]] as const) {
    const items = Array.from({ length: count }, (_, id) => ({ kind: 'image' as const, id }));
    const groups = groupAttachments(items);
    assert.deepEqual(groups.map((group) => group.length), lengths);
    assert.deepEqual(groups.flat(), items);
  }
  for (const kind of ['audio', 'video'] as const) assert.deepEqual(groupAttachments([{ kind }, { kind }]).map((group) => group.length), [1, 1]);
});

test('selection validates every file, size and batch count before starting uploads', () => {
  const image = new File([new Uint8Array(1)], 'photo.png', { type: 'image/png' });
  const bad = new File([], 'empty.png', { type: 'image/png' });
  assert.doesNotThrow(() => validateAttachmentSelection(Array(30).fill(image), 'image'));
  assert.doesNotThrow(() => validateAttachmentSelection(Array(1000).fill(image), 'image'));
  assert.throws(() => validateAttachmentSelection([image, bad], 'image'), /empty.png/);
  assert.throws(() => validateAttachmentSelection(Array(21).fill(image), 'audio'), /до 20/);
  assert.throws(() => validateAttachmentSelection(Array(11).fill(image), 'video'), /до 10/);
  assert.throws(() => validateAttachmentSelection([new File(['x'], 'bad.exe')], 'audio'), /MP3/);
});


test('invalid files are excluded independently while valid files and their order survive', () => {
  const good = new File(['x'], 'good.png', { type: 'image/png' });
  const next = new File(['y'], 'next.jpg', { type: 'image/jpeg' });
  const large = new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'too-big.png', { type: 'image/png' });
  const acceptedLarge = new File([new Uint8Array(25 * 1024 * 1024)], 'large.png', { type: 'image/png' });
  const empty = new File([], 'empty.png', { type: 'image/png' });
  const result = partitionAttachmentSelection([good, large, next, empty, acceptedLarge], 'image');
  assert.deepEqual(result.accepted, [good, next, acceptedLarge]);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /too-big.png.*25 МБ/);
  assert.match(result.errors[1], /empty.png/);
});


test('repeated selections append mixed files and enforce cumulative per-kind limits', () => {
  let id = 0; const next = () => String(++id);
  const video = new File(['x'], 'one.mp4', { type: 'video/mp4' });
  const audio = new File(['x'], 'one.mp3', { type: 'audio/mpeg' });
  const photo = new File(['x'], 'one.png', { type: 'image/png' });
  const arbitrary = new File(['x'], 'project.blend');
  let draft = appendAttachmentSelection([], [video], 'video', next).items;
  draft = appendAttachmentSelection(draft, [video], 'video', next).items;
  draft = appendAttachmentSelection(draft, [audio], 'audio', next).items;
  draft = appendAttachmentSelection(draft, [photo, photo], 'image', next).items;
  draft = appendAttachmentSelection(draft, [arbitrary], 'image', next).items;
  assert.deepEqual(draft.map((item) => item.kind), ['video', 'video', 'audio', 'image', 'image', 'document']);
  assert.equal(new Set(draft.map((item) => item.id)).size, 6);
  const result = appendAttachmentSelection(draft, [new File([], 'empty.unknown')], 'document', next);
  assert.deepEqual(result.items, draft);
  assert.equal(result.errors.length, 1);
  draft = appendAttachmentSelection([], Array(20).fill(audio), 'audio', next).items;
  const capped = appendAttachmentSelection(draft, [audio, photo], 'audio', next);
  assert.equal(capped.items.length, 21); // The photo falls back to an ordinary file.
  assert.equal(capped.errors.length, 1);
  assert.deepEqual(groupAttachments(capped.items).map((group) => group.length), Array(21).fill(1));
});


test('unsupported media and size/MIME restrictions fall back to ordinary files, not auth/network/server failures', () => {
  const item = { id: 'fallback', kind: 'video' as const, file: new File(['x'], 'video.mp4', { type: 'video/mp4' }) };
  for (const status of [400, 413, 415, 422]) assert(canFallbackToFile(new UploadHttpError('unsupported', status), item));
  for (const status of [401, 403, 408, 429, 500, 503]) assert(!canFallbackToFile(new UploadHttpError('failure', status), item));
  assert(!canFallbackToFile(new Error('offline'), item));
  assert(!canFallbackToFile(new UploadHttpError('unsupported', 415), { ...item, asFile: true }));
  const oversized = new File(['x'], 'large.mp4', { type: 'video/mp4' });
  Object.defineProperty(oversized, 'size', { value: 51 * 1024 * 1024 });
  assert.equal(attachmentKindForFile(oversized, 'video'), 'document');
  const image = new File(['x'], 'test.png', { type: 'application/octet-stream' });
  assert.equal(attachmentKindForFile(image, 'image'), 'document');
  const items = [
    { id: 'a', kind: 'image' as const },
    { id: 'b', kind: 'document' as const },
    { id: 'c', kind: 'image' as const },
  ];
  assert.deepEqual(groupAttachments(items).map((group) => group.map((item) => item.id)), [['a'], ['b'], ['c']]);
});
