import JSZip from "jszip";
import { extractHwpxTablesFromBuffer } from "../education/hwpx";
import type { HwpBlock, HwpCell } from "./hwp-parse";
import {
  assertBulletinSourceSize,
  assertSafeZipMetadata,
  createArchiveOutputBudget,
  isBulletinFileLimitError,
  readLimitedZipEntry,
} from "./attachment-limits";

export async function parseHwpxBlocks(file: Uint8Array): Promise<HwpBlock[]> {
  const extraction = await extractHwpxTablesFromBuffer(file);
  const rowsByTable = new Map<number, typeof extraction.rows>();

  for (const row of extraction.rows) {
    const rows = rowsByTable.get(row.sourceTableNo) ?? [];
    rows.push(row);
    rowsByTable.set(row.sourceTableNo, rows);
  }

  return [...rowsByTable.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, rows]): HwpBlock => {
      const cells: HwpCell[] = rows.flatMap((row) =>
        row.cells.map((cell) => ({
          c: cell.col,
          r: cell.row,
          cs: Math.max(1, cell.colSpan),
          rs: Math.max(1, cell.rowSpan),
          b: cell.text ? [{ t: "p" as const, x: cell.text }] : [],
        })),
      );
      const rowCount = cells.reduce((max, cell) => Math.max(max, cell.r + cell.rs), 0);
      const colCount = cells.reduce((max, cell) => Math.max(max, cell.c + cell.cs), 0);
      return { t: "tbl", rows: rowCount, cols: colCount, cells };
    })
    .filter((block) => block.t === "tbl" && block.cells.some((cell) => cell.b.length > 0));
}

export async function extractHwpxPreview(
  file: Uint8Array,
): Promise<{ image: Uint8Array; contentType: string } | null> {
  try {
    assertBulletinSourceSize(file.byteLength);
    const archive = await JSZip.loadAsync(file);
    assertSafeZipMetadata(archive);
    const previewName = Object.keys(archive.files).find((name) =>
      /^Preview\/PrvImage\.(?:png|jpe?g|gif|webp|bmp)$/i.test(name),
    );
    if (!previewName) return null;

    const entry = archive.file(previewName);
    if (!entry) return null;
    const image = await readLimitedZipEntry(entry, createArchiveOutputBudget());
    if (image.length < 100) return null;

    const extension = previewName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    const contentType =
      extension === "png" ? "image/png"
      : extension === "jpg" || extension === "jpeg" ? "image/jpeg"
      : extension === "gif" ? "image/gif"
      : extension === "webp" ? "image/webp"
      : extension === "bmp" ? "image/bmp"
      : null;
    return contentType ? { image, contentType } : null;
  } catch (error) {
    if (isBulletinFileLimitError(error)) throw error;
    return null;
  }
}
