import { test } from "node:test";
import assert from "node:assert/strict";
import { readMediaRepeat, saveMediaRepeat } from "../src/lib/media-repeat.ts";

test("repeat on/off persists independently for music and video", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  assert.equal(readMediaRepeat("audio", storage), false);
  saveMediaRepeat("audio", true, storage);
  assert.equal(readMediaRepeat("audio", storage), true);
  assert.equal(readMediaRepeat("video", storage), false);
  saveMediaRepeat("video", true, storage);
  saveMediaRepeat("audio", false, storage);
  assert.equal(readMediaRepeat("audio", storage), false);
  assert.equal(readMediaRepeat("video", storage), true);
});

test("invalid/unavailable repeat storage safely defaults to off", () => {
  for (const stored of [null, "", "false", "1", "bad"]) assert.equal(readMediaRepeat("video", { getItem: () => stored, setItem: () => {} }), false);
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readMediaRepeat("audio", blocked), false);
  assert.doesNotThrow(() => saveMediaRepeat("audio", true, blocked));
  assert.equal(readMediaRepeat("video", null), false);
});
