import { test } from "node:test";
import assert from "node:assert/strict";
import { readMediaVolume, saveMediaVolume } from "../src/lib/media-volume.ts";

test("music and video volumes persist independently, including zero", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  assert.equal(readMediaVolume("audio", storage), 1);
  saveMediaVolume("audio", .24, storage);
  saveMediaVolume("video", .63, storage);
  assert.equal(readMediaVolume("audio", storage), .24);
  assert.equal(readMediaVolume("video", storage), .63);
  saveMediaVolume("video", 0, storage);
  assert.equal(readMediaVolume("video", storage), 0);
  assert.equal(readMediaVolume("audio", storage), .24);
});

test("invalid/blocked storage never breaks playback or yields invalid volume", () => {
  for (const value of ["", "bad", "-1", "1.1", "Infinity", "NaN"]) {
    assert.equal(readMediaVolume("audio", { getItem: () => value, setItem: () => {} }), 1);
  }
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readMediaVolume("audio", blocked), 1);
  assert.doesNotThrow(() => saveMediaVolume("video", .4, blocked));
  assert.equal(readMediaVolume("video", null), 1);
  const writes: string[] = [];
  for (const value of [NaN, Infinity, -1, 2]) saveMediaVolume("audio", value, { getItem: () => null, setItem: (key) => { writes.push(key); } });
  assert.deepEqual(writes, []);
});
