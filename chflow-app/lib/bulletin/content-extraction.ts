import JSZip from "jszip";
import { Workbook } from "exceljs";
import { extractText, getDocumentProxy } from "unpdf";
import { parseHwpBlocks, type HwpBlock } from "./hwp-parse";
import { parseHwpxBlocks } from "./hwpx-parse";
import { assertSafeZipMetadata } from "./attachment-limits";
import {
  normText,
  parseDeptBulletinFields,
  type DeptBulletinFields,
} from "./dept-bulletin-fields";

export type BulletinTextExtraction = {
  text: string;
  fields: DeptBulletinFields;
  method: "native" | "ocr";
  needsOcr: boolean;
};

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function flattenBlocks(blocks: HwpBlock[]): string {
  return blocks.map((block) => {
    if (block.t === "p") return block.x;
    return block.cells.map((cell) => flattenBlocks(cell.b)).filter(Boolean).join(" ");
  }).filter(Boolean).join("\n");
}

async function extractPdfText(file: Uint8Array) {
  const document = await getDocumentProxy(file);
  const { text } = await extractText(document, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

async function extractPptxText(file: Uint8Array) {
  const archive = await JSZip.loadAsync(file);
  const slides = Object.keys(archive.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/i)?.[1]) - Number(b.match(/slide(\d+)/i)?.[1]));
  const texts = await Promise.all(slides.map(async (name) => {
    const xml = await archive.file(name)?.async("text");
    if (!xml) return "";
    return [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi)]
      .map((match) => decodeXml(match[1]))
      .join(" ");
  }));
  return texts.filter(Boolean).join("\n");
}

async function extractXlsxText(file: Uint8Array) {
  // XLSX is a ZIP container. Validate its expansion metadata before ExcelJS opens it.
  const archive = await JSZip.loadAsync(file);
  assertSafeZipMetadata(archive);
  const workbook = new Workbook();
  const load = workbook.xlsx.load.bind(workbook.xlsx) as unknown as (data: Uint8Array) => Promise<unknown>;
  await load(file);
  const lines: string[] = [];
  for (const worksheet of workbook.worksheets) {
    lines.push(worksheet.name);
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.from({ length: Math.min(row.cellCount, 30) }, (_, index) => row.getCell(index + 1).text)
        .filter(Boolean);
      if (values.length) lines.push(values.join(" | "));
    });
  }
  return lines.join("\n");
}

function extensionOf(path: string) {
  return path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "";
}

export async function extractNativeBulletinText(file: Uint8Array, path: string): Promise<BulletinTextExtraction> {
  const extension = extensionOf(path);
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(extension)) {
    return { text: "", fields: {}, method: "native", needsOcr: true };
  }

  let text = "";
  if (extension === "pdf") text = await extractPdfText(file);
  else if (extension === "pptx") text = await extractPptxText(file);
  else if (extension === "xlsx") text = await extractXlsxText(file);
  else if (extension === "hwp") text = flattenBlocks(parseHwpBlocks(Buffer.from(file)));
  else if (extension === "hwpx") text = flattenBlocks(await parseHwpxBlocks(file));
  else throw new Error("unsupported_bulletin_file_type");

  return {
    text,
    fields: parseDeptBulletinFields(normText(text)),
    method: "native",
    needsOcr: false,
  };
}

export function extractOcrBulletinText(text: string): BulletinTextExtraction {
  return {
    text,
    fields: parseDeptBulletinFields(normText(text)),
    method: "ocr",
    needsOcr: false,
  };
}
