import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_DOCUMENT_SIZE } from '../src/lib/document-types.ts';
import { validateAttachmentSelection } from '../src/lib/attachment-batch.ts';
import { InputError } from '../src/lib/request-body.ts';

function request(chunks: Uint8Array[], headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request('http://local/upload', { method: 'POST', headers, signal, ...{ duplex: 'half' }, body: new ReadableStream({
    pull(controller) { const next = chunks.shift(); if (next) controller.enqueue(next); else controller.close(); },
  }) });
}

test('2 GiB boundary, bounded streaming, abort and corrupt-upload cleanup', async () => {
  assert.equal(MAX_DOCUMENT_SIZE, 2147483648);
  const file = new File(['x'], 'archive.rar');
  Object.defineProperty(file, 'size', { value: MAX_DOCUMENT_SIZE, configurable: true });
  assert.doesNotThrow(() => validateAttachmentSelection([file], 'document'));
  Object.defineProperty(file, 'size', { value: MAX_DOCUMENT_SIZE + 1 });
  assert.throws(() => validateAttachmentSelection([file], 'document'), /2 ГБ/);
  const cwd = process.cwd(), root = await mkdtemp(join(tmpdir(), 'mediachat-document-stream-'));
  try {
    process.chdir(root);
    const { streamDocumentBody, saveStreamedDocument } = await import('../src/lib/document-stream.ts');
    const { DOCUMENT_DIR, assertOwnedDocument } = await import('../src/lib/document-storage.ts');
    const target = join(root, 'body.bin');
    assert.equal(await streamDocumentBody(request([Buffer.from('ab'), Buffer.from('cd')]), target, 4), 4);
    assert.equal(await readFile(target, 'utf8'), 'abcd');
    await assert.rejects(streamDocumentBody(request([Buffer.alloc(1)], { 'content-length': String(MAX_DOCUMENT_SIZE + 1) }), join(root, 'over.bin')), (error: unknown) => error instanceof InputError && error.status === 413);
    await assert.rejects(streamDocumentBody(request([Buffer.alloc(3), Buffer.alloc(3)]), join(root, 'actual-over.bin'), 4), /2 ГБ/);
    await assert.rejects(streamDocumentBody(request([Buffer.alloc(2)], { 'content-length': '3' }), join(root, 'truncated.bin')), /не полностью/);
    await assert.rejects(saveStreamedDocument(request([]), 'empty.rar', 1));
    await assert.rejects(saveStreamedDocument(request([Buffer.from('not zip')]), 'broken.zip', 1));
    const abort = new AbortController(); abort.abort();
    await assert.rejects(saveStreamedDocument(request([Buffer.from('x')], {}, abort.signal), 'cancel.rar', 1));
    const stored = await saveStreamedDocument(request([Buffer.from([0, 255]), Buffer.from([1, 2])]), 'archive.rar', 1);
    assert.deepEqual(await readFile(join(DOCUMENT_DIR, stored.url.split('/').pop()!)), Buffer.from([0, 255, 1, 2]));
    await assert.doesNotReject(assertOwnedDocument(stored.url, 1));
    await assert.rejects(assertOwnedDocument(stored.url, 2));
    const opaque = await saveStreamedDocument(request([Buffer.from('unsupported pdf bytes')]), 'opaque.pdf', 1, true);
    assert(opaque.url.endsWith('.bin'));
    assert.equal(opaque.mimeType, 'application/octet-stream');
    await assert.doesNotReject(assertOwnedDocument(opaque.url, 1));
    await assert.rejects(assertOwnedDocument(opaque.url, 2));
    assert.deepEqual(await readdir(join(DOCUMENT_DIR, 'staging')), []);
    assert.equal((await readdir(join(DOCUMENT_DIR, 'metadata'))).length, 2);
  } finally { process.chdir(cwd); await rm(root, { recursive: true, force: true }); }
});
