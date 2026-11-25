import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertOwnedMedia } from "../src/lib/owned-media.ts";
import { consumeLimit } from "../src/lib/rate-limit.ts";
import { InputError, readLimitedBody } from "../src/lib/request-body.ts";

test("known private image URL cannot be attached by another user", async () => {
  const cwd = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "mediachat-security-"));
  const id = "12345678-1234-1234-1234-123456789abc";
  try {
    process.chdir(root);
    await mkdir("uploads/metadata", { recursive: true });
    await writeFile(`uploads/${id}.png`, Buffer.from([1, 2, 3]));
    await writeFile(`uploads/metadata/${id}.json`, JSON.stringify({ id, extension: "png", ownerId: 1, size: 3 }));
    await assert.doesNotReject(assertOwnedMedia(`/api/images/${id}.png`, 1, "image"));
    await assert.rejects(assertOwnedMedia(`/api/images/${id}.png`, 2, "image"));
    await assert.rejects(assertOwnedMedia("/api/images/../../secret.png", 1, "image"));
    await writeFile(`uploads/${id}.png`, Buffer.from([1]));
    await assert.rejects(assertOwnedMedia(`/api/images/${id}.png`, 1, "image"));
  } finally { process.chdir(cwd); await rm(root, { recursive: true, force: true }); }
});

test("rate limit enforces window and recovers after expiration", () => {
  assert.equal(consumeLimit("test", 2, 1000, 1000), 0);
  assert.equal(consumeLimit("test", 2, 1000, 1000), 0);
  assert.equal(consumeLimit("test", 2, 1000, 1000), 1);
  assert.equal(consumeLimit("test", 2, 1000, 2001), 0);
});

test("body limit applies even without content-length", async () => {
  await assert.rejects(readLimitedBody(new Request("http://local", { method: "POST", body: "abcdef" }), 3),
    (error: unknown) => error instanceof InputError && error.status === 413);
  assert.equal(new TextDecoder().decode(await readLimitedBody(new Request("http://local", { method: "POST", body: "abc" }), 3)), "abc");
});
