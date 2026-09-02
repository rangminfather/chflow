import type JSZip from "jszip";

const MIB = 1024 * 1024;

// UMS does not expose a reliable board-specific limit. Keep the source limit
// aligned with the repository's existing 50 MiB storage limit.
export const MAX_BULLETIN_SOURCE_BYTES = 50 * MIB;
export const MAX_ARCHIVE_EXPANDED_BYTES = 200 * MIB;
export const MAX_ARCHIVE_ENTRIES = 2_048;
export const MAX_ARCHIVE_SINGLE_ENTRY_BYTES = 50 * MIB;
export const MAX_ARCHIVE_COMPRESSION_RATIO = 200;

export type BulletinFileLimitCode =
  | "source_too_large"
  | "archive_too_many_entries"
  | "archive_entry_too_large"
  | "archive_expanded_too_large"
  | "archive_compression_ratio_too_high";

export class BulletinFileLimitError extends Error {
  readonly code: BulletinFileLimitCode;

  constructor(code: BulletinFileLimitCode) {
    super(`bulletin_file_limit:${code}`);
    this.name = "BulletinFileLimitError";
    this.code = code;
  }
}

export function isBulletinFileLimitError(error: unknown): error is BulletinFileLimitError {
  return error instanceof BulletinFileLimitError;
}

export function assertBulletinSourceSize(byteLength: number) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > MAX_BULLETIN_SOURCE_BYTES) {
    throw new BulletinFileLimitError("source_too_large");
  }
}

function contentLengthOf(response: Response): number | null {
  const raw = response.headers.get("content-length");
  if (!raw || !/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export async function readLimitedResponseBytes(
  response: Response,
  maxBytes = MAX_BULLETIN_SOURCE_BYTES,
): Promise<Uint8Array> {
  const declaredLength = contentLengthOf(response);
  if (declaredLength !== null && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new BulletinFileLimitError("source_too_large");
  }

  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new BulletinFileLimitError("source_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

type ZipObjectWithMetadata = JSZip.JSZipObject & {
  _data?: {
    compressedSize?: number;
    uncompressedSize?: number;
  };
};

export function assertSafeZipMetadata(archive: JSZip) {
  const entries = Object.values(archive.files).filter((entry) => !entry.dir) as ZipObjectWithMetadata[];
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new BulletinFileLimitError("archive_too_many_entries");
  }

  let expandedTotal = 0;
  for (const entry of entries) {
    const compressed = entry._data?.compressedSize;
    const expanded = entry._data?.uncompressedSize;
    if (
      !Number.isSafeInteger(compressed) ||
      !Number.isSafeInteger(expanded) ||
      compressed === undefined ||
      expanded === undefined ||
      compressed < 0 ||
      expanded < 0
    ) {
      throw new BulletinFileLimitError("archive_expanded_too_large");
    }
    if (expanded > MAX_ARCHIVE_SINGLE_ENTRY_BYTES) {
      throw new BulletinFileLimitError("archive_entry_too_large");
    }
    expandedTotal += expanded;
    if (expandedTotal > MAX_ARCHIVE_EXPANDED_BYTES) {
      throw new BulletinFileLimitError("archive_expanded_too_large");
    }
    if (expanded > 0 && (compressed === 0 || expanded / compressed > MAX_ARCHIVE_COMPRESSION_RATIO)) {
      throw new BulletinFileLimitError("archive_compression_ratio_too_high");
    }
  }
}

export type ArchiveOutputBudget = {
  used: number;
  limit: number;
};

export function createArchiveOutputBudget(): ArchiveOutputBudget {
  return { used: 0, limit: MAX_ARCHIVE_EXPANDED_BYTES };
}

export async function readLimitedZipEntry(
  entry: JSZip.JSZipObject,
  budget: ArchiveOutputBudget,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let entryBytes = 0;
  const stream = entry.nodeStream("nodebuffer");

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      stream.pause();
      reject(error);
    };

    stream.on("data", (chunk: Buffer) => {
      if (settled) return;
      entryBytes += chunk.byteLength;
      budget.used += chunk.byteLength;
      if (entryBytes > MAX_ARCHIVE_SINGLE_ENTRY_BYTES) {
        fail(new BulletinFileLimitError("archive_entry_too_large"));
        return;
      }
      if (budget.used > budget.limit) {
        fail(new BulletinFileLimitError("archive_expanded_too_large"));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", fail);
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      const output = new Uint8Array(entryBytes);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(output);
    });
    stream.resume();
  });
}
