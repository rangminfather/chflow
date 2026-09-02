import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_SINGLE_ENTRY_BYTES,
  MAX_BULLETIN_SOURCE_BYTES,
  BulletinFileLimitError,
  assertBulletinSourceSize,
  assertSafeZipMetadata,
  readLimitedResponseBytes,
  readLimitedZipEntry,
} from "./attachment-limits";

async function loadedZip(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [name, value] of Object.entries(files)) zip.file(name, value);
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  return JSZip.loadAsync(bytes);
}

function metadataOf(entry: JSZip.JSZipObject) {
  return (entry as JSZip.JSZipObject & {
    _data: { compressedSize: number; uncompressedSize: number };
  })._data;
}

describe("bulletin attachment limits", () => {
  it("rejects a declared oversized response before reading its body", async () => {
    const response = new Response("small", { headers: { "content-length": "11" } });
    await expect(readLimitedResponseBytes(response, 10)).rejects.toMatchObject({
      code: "source_too_large",
    });
  });

  it("rejects a chunked response as soon as the streamed bytes exceed the limit", async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(6));
        controller.close();
      },
    }));
    await expect(readLimitedResponseBytes(response, 10)).rejects.toMatchObject({
      code: "source_too_large",
    });
  });

  it("rejects an oversized source using metadata without allocating it", () => {
    expect(() => assertBulletinSourceSize(MAX_BULLETIN_SOURCE_BYTES + 1)).toThrow(
      BulletinFileLimitError,
    );
  });

  it("rejects excessive ZIP entry counts", async () => {
    const archive = await loadedZip({ "safe.txt": "safe" });
    const entry = archive.file("safe.txt")!;
    for (let index = 0; index < MAX_ARCHIVE_ENTRIES; index += 1) {
      archive.files[`synthetic-${index}.txt`] = entry;
    }
    expect(() => assertSafeZipMetadata(archive)).toThrowError(
      expect.objectContaining({ code: "archive_too_many_entries" }),
    );
  });

  it("rejects oversized and abnormally compressed ZIP metadata", async () => {
    const oversized = await loadedZip({ "large.bin": "safe" });
    metadataOf(oversized.file("large.bin")!).uncompressedSize = MAX_ARCHIVE_SINGLE_ENTRY_BYTES + 1;
    expect(() => assertSafeZipMetadata(oversized)).toThrowError(
      expect.objectContaining({ code: "archive_entry_too_large" }),
    );

    const highRatio = await loadedZip({ "ratio.bin": "safe" });
    metadataOf(highRatio.file("ratio.bin")!).compressedSize = 1;
    metadataOf(highRatio.file("ratio.bin")!).uncompressedSize = 201;
    expect(() => assertSafeZipMetadata(highRatio)).toThrowError(
      expect.objectContaining({ code: "archive_compression_ratio_too_high" }),
    );
  });

  it("enforces the output budget while decompressing", async () => {
    const archive = await loadedZip({ "entry.txt": "0123456789" });
    await expect(readLimitedZipEntry(archive.file("entry.txt")!, { used: 0, limit: 5 })).rejects.toMatchObject({
      code: "archive_expanded_too_large",
    });
  });
});
