import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseRange } from "../src/lib/http-range.ts";
import { validateVideoSelection, MAX_VIDEO_SIZE } from "../src/lib/video-types.ts";
import { videoProbeInfo, matchesVideoSignature } from "../src/lib/video-storage.ts";

// Независимые процессы node:test не меняют cwd друг друга.
test("Range: whole file, bounded/open/suffix ranges, invalid and overflow", () => {
  assert.deepEqual(parseRange(null, 100), { start: 0, end: 99, status: 200 });
  assert.deepEqual(parseRange("bytes=10-19", 100), { start: 10, end: 19, status: 206 });
  assert.deepEqual(parseRange("bytes=90-999", 100), { start: 90, end: 99, status: 206 });
  assert.deepEqual(parseRange("bytes=10-", 100), { start: 10, end: 99, status: 206 });
  assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99, status: 206 });
  assert.deepEqual(parseRange("bytes=-1000", 100), { start: 0, end: 99, status: 206 });
  for (const value of ["bytes=100-", "bytes=20-10", "bytes=-0", "bytes=-", "bytes=0-1,4-5", "bytes=0-999999999999999999999", "other=0-1"]) assert.equal(parseRange(value, 100), null);
});

test("video selection rejects unsafe name, wrong MIME, empty/oversized file", () => {
  assert.equal(validateVideoSelection("Клип.mp4", "video/mp4", 100), "mp4");
  assert.equal(validateVideoSelection("clip.webm", "", 100), "webm");
  for (const [name, type, size] of [["../clip.mp4", "video/mp4", 1], ["clip.avi", "video/mp4", 1], ["clip.mp4", "video/webm", 1], ["clip.mp4", "video/mp4", 0], ["clip.mp4", "video/mp4", MAX_VIDEO_SIZE + 1]] as const) assert.throws(() => validateVideoSelection(name, type, size));
  assert.equal(matchesVideoSignature(Buffer.from("not a video"), "mp4"), false);
  assert.throws(() => videoProbeInfo({ streams: [{ codec_type: "video", codec_name: "hevc", width: 1280, height: 720, pix_fmt: "yuv420p" }], format: { format_name: "mov,mp4", duration: "10" } }, "mp4"));
});

test("real FFmpeg: MP4/WebM, exact original, poster, ownership, corrupt cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "mediachat-video-test-"));
  const cwd = process.cwd();
  try {
    // Import с cache key: VIDEO_DIR должен указывать только в временную директорию теста.
    process.chdir(root);
    const storage = await import(new URL(`../src/lib/video-storage.ts?test=${Date.now()}`, import.meta.url).href);
    for (const extension of ["mp4", "webm"] as const) {
      const input = join(root, `fixture.${extension}`);
      execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=5", "-t", "1",
        "-c:v", extension === "mp4" ? "libx264" : "libvpx-vp9", "-threads", "1", "-pix_fmt", "yuv420p", input], { timeout: 20_000 });
      const bytes = await readFile(input);
      assert(matchesVideoSignature(bytes.subarray(0, 65536), extension));
      const video = await storage.saveVideo(new Request("http://local/api/videos/upload", { method: "POST", headers: { "content-type": `video/${extension}` }, body: bytes }), `Оригинал.${extension}`, 1);
      assert.equal(video.videoCodec, extension === "mp4" ? "h264" : "vp9");
      assert.deepEqual(await readFile(join(storage.VIDEO_DIR, video.url.split("/").pop()!)), bytes);
      assert((await readFile(join(storage.VIDEO_DIR, "posters", `${video.url.split("/").pop()!.split(".")[0]}.jpg`))).length > 0);
      await assert.doesNotReject(storage.assertOwnedVideo(video.url, 1));
      await assert.rejects(storage.assertOwnedVideo(video.url, 2));
      assert.equal(await storage.readVideo("../../secret.mp4"), null);
    }
    const livePath = join(root, "no-duration.webm");
    execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=5", "-t", "1", "-c:v", "libvpx-vp9", "-threads", "1", "-live", "1", livePath]);
    const live = await storage.saveVideo(new Request("http://local", { method: "POST", headers: { "content-type": "video/webm" }, body: await readFile(livePath) }), "no-duration.webm", 1);
    assert(live.duration > .5 && live.duration <= 1.1);
    const shortestPath = join(root, "shortest.mp4");
    execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=25", "-frames:v", "1", "-c:v", "libx264", "-threads", "1", shortestPath]);
    const shortest = await storage.saveVideo(new Request("http://local", { method: "POST", headers: { "content-type": "video/mp4" }, body: await readFile(shortestPath) }), "shortest.mp4", 1);
    assert(shortest.duration > 0 && shortest.duration < .1);
    await assert.rejects(storage.saveVideo(new Request("http://local", { method: "POST", headers: { "content-type": "video/mp4" }, body: "corrupt" }), "bad.mp4", 1));
    const hugeStream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_VIDEO_SIZE + 1)); controller.close(); } });
    await assert.rejects(storage.saveVideo(new Request("http://local", { method: "POST", headers: { "content-type": "video/mp4" }, body: hugeStream, duplex: "half" } as RequestInit), "large.mp4", 1));
    assert.deepEqual(await readdir(join(storage.VIDEO_DIR, "staging")), []);
  } finally { process.chdir(cwd); await rm(root, { recursive: true, force: true }); }
});
