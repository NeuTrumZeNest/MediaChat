import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { canManageMember, groupTitle } from '../src/lib/group-policy.ts';
import { prepareAvatar, avatarFilename } from '../src/lib/avatar-storage.ts';
import { db } from '../src/prisma/db.ts';
test('group management matrix protects owners and admins', () => {
  for (const actor of ['owner', 'admin', 'member']) for (const target of ['owner', 'admin', 'member'])
    assert.equal(canManageMember(actor, target), actor === 'owner' ? target !== 'owner' : actor === 'admin' && target === 'member');
  assert.equal(groupTitle(' Group '), 'Group');
  for (const value of ['', ' '.repeat(10), null, 3, 'x'.repeat(81)]) assert.throws(() => groupTitle(value));
});
test('avatar crop validates content, limits and produces metadata-free 512 WebP', async () => {
  try {
    const bytes = await sharp({ create: { width: 200, height: 100, channels: 3, background: 'red' } }).png().toBuffer();
    const output = await prepareAvatar(bytes, 'image/png', { x: .25, y: 0, size: 1 });
    const metadata = await sharp(output).metadata(); assert.equal(metadata.width, 512); assert.equal(metadata.height, 512); assert.equal(metadata.format, 'webp'); assert.equal(metadata.exif, undefined);
    for (const crop of [{ x: -1, y: 0, size: 1 }, { x: 1, y: 0, size: 1 }, { x: 0, y: 0, size: 0 }, { x: 0, y: 0, size: 2 }]) await assert.rejects(prepareAvatar(bytes, 'image/png', crop));
    await assert.rejects(prepareAvatar(Buffer.from('bad'), 'image/png', { x: 0, y: 0, size: 1 }));
    await assert.rejects(prepareAvatar(bytes, 'image/jpeg', { x: 0, y: 0, size: 1 }));
    await assert.rejects(prepareAvatar(new Uint8Array(10 * 1024 * 1024 + 1), 'image/png', { x: 0, y: 0, size: 1 }));
    assert.equal(avatarFilename('/api/avatars/../../.env'), null);
  } finally { await db.close(); }
});
