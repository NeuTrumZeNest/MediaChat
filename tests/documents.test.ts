import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateDocument, documentName } from "../src/lib/document-format.ts";
import { zipFixture } from "./zip-fixture.ts";

test("document signatures and UTF-8 validation", () => {
  assert.equal(validateDocument(Buffer.from("Привет\n"), "Заметка.txt").mimeType, "text/plain");
  assert.equal(validateDocument(Buffer.from("a,b\n1,2"), "data.csv").extension, "csv");
  assert.equal(validateDocument(Buffer.from("%PDF-1.7\nexample\n%%EOF"), "report.pdf").extension, "pdf");
  for (const [data, name] of [[Buffer.alloc(0), "empty.txt"], [Buffer.from("not a pdf"), "fake.pdf"],
    [Buffer.from([0xff, 0xfe]), "binary.txt"], [Buffer.from([0]), "null.txt"]] as const) {
    assert.throws(() => validateDocument(data, name));
  }
  for (const name of ["../secret.txt", "bad\n.txt", ".hidden.txt", "a".repeat(241) + ".txt"]) assert.throws(() => documentName(name));
});

test("ZIP integrity, paths, Office container, decompression bounds", () => {
  const zip = zipFixture([{ name: "hello.txt", data: Buffer.from("hello") }]);
  assert.equal(validateDocument(zip, "archive.zip").size, zip.length);
  assert.throws(() => validateDocument(zip, "fake.docx"));
  assert.throws(() => validateDocument(zip.subarray(0, -1), "broken.zip"));
  const corrupt = Buffer.from(zip); corrupt[30 + "hello.txt".length] ^= 1;
  assert.throws(() => validateDocument(corrupt, "bad-crc.zip"));
  assert.throws(() => validateDocument(zipFixture([{ name: "../escape.txt", data: Buffer.from("x") }]), "unsafe.zip"));
  const office = zipFixture(["[Content_Types].xml", "_rels/.rels", "word/document.xml"].map((name) => ({ name, data: Buffer.from("<xml/>") })));
  assert.equal(validateDocument(office, "Документ.docx").extension, "docx");
  const bomb = Buffer.from(zip); const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bomb.writeUInt32LE(101 * 1024 * 1024, central + 24);
  assert.throws(() => validateDocument(bomb, "bomb.zip"));
});

test("original bytes and metadata survive storage; foreign attachment denied", async () => {
  const cwd = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "mediachat-documents-"));
  try {
    process.chdir(root);
    const storage = await import("../src/lib/document-storage.ts");
    const bytes = Buffer.from("Оригинальный документ\n");
    const first = await storage.saveDocument(bytes, "Мой файл.txt", 1);
    const second = await storage.saveDocument(bytes, "Мой файл.txt", 1);
    assert.notEqual(first.url, second.url);
    assert.deepEqual(await readFile(join(storage.DOCUMENT_DIR, first.url.split("/").pop()!)), bytes);
    assert.equal((await storage.getDocumentInfo(first.url))?.originalName, "Мой файл.txt");
    await assert.doesNotReject(storage.assertOwnedDocument(first.url, 1));
    await assert.rejects(storage.assertOwnedDocument(first.url, 2));
    assert.equal(await storage.getDocumentInfo("/api/documents/../../secret.txt"), null);
    for (const name of ['unknown.project', 'script.html', 'setup.exe', 'LICENSE', 'a.weird-ext']) {
      const binary = Buffer.from([0, 255, 60, 115, 99, 114, 105, 112, 116, 62]);
      const generic = await storage.saveDocument(binary, name, 1);
      assert(generic.url.endsWith('.bin'));
      assert.equal(generic.mimeType, 'application/octet-stream');
      assert.equal((await storage.getDocumentInfo(generic.url))?.originalName, name);
      assert.deepEqual(await readFile(join(storage.DOCUMENT_DIR, generic.url.split('/').pop()!)), binary);
      await assert.doesNotReject(storage.assertOwnedDocument(generic.url, 1));
      await assert.rejects(storage.assertOwnedDocument(generic.url, 2));
    }
  } finally { process.chdir(cwd); await rm(root, { recursive: true, force: true }); }
});
