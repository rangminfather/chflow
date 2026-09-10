import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type { HwpxCell, HwpxExtraction, HwpxRow } from "./types";
import {
  assertBulletinSourceSize,
  assertSafeZipMetadata,
  createArchiveOutputBudget,
  readLimitedZipEntry,
} from "../bulletin/attachment-limits";

type OrderedNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

function childContent(node: OrderedNode, tag: string): OrderedNode[] | null {
  const value = node[tag];
  return Array.isArray(value) ? (value as OrderedNode[]) : null;
}

function attributes(node: OrderedNode): Record<string, string> {
  const attrs = node[":@"];
  return attrs && typeof attrs === "object" ? (attrs as Record<string, string>) : {};
}

function findNodes(
  nodes: OrderedNode[],
  tag: string,
  options: { stopAt?: string } = {},
): OrderedNode[] {
  const found: OrderedNode[] = [];
  for (const node of nodes) {
    for (const [key, value] of Object.entries(node)) {
      if (key === ":@" || key === "#text") continue;
      if (key === tag && Array.isArray(value)) {
        found.push(node);
      }
      if (key === options.stopAt && key !== tag) continue;
      if (Array.isArray(value)) {
        found.push(...findNodes(value as OrderedNode[], tag, options));
      }
    }
  }
  return found;
}

function collectText(nodes: OrderedNode[]): string {
  const chunks: string[] = [];
  for (const node of nodes) {
    const text = node["#text"];
    if (typeof text === "string") chunks.push(text);
    for (const [key, value] of Object.entries(node)) {
      if (key === ":@" || key === "#text" || !Array.isArray(value)) continue;
      chunks.push(collectText(value as OrderedNode[]));
    }
  }
  return chunks.join("").replace(/\s+/g, " ").trim();
}

function numberAttribute(attrs: Record<string, string>, name: string, fallback: number): number {
  const value = attrs[`@_${name}`] ?? attrs[name];
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCell(cellNode: OrderedNode, fallbackCol: number, fallbackRow: number): HwpxCell {
  const content = childContent(cellNode, "tc") ?? [];
  const addressNode = findNodes(content, "cellAddr")[0];
  const spanNode = findNodes(content, "cellSpan")[0];
  const address = addressNode ? attributes(addressNode) : {};
  const span = spanNode ? attributes(spanNode) : {};
  const textNodes = findNodes(content, "t");

  return {
    col: numberAttribute(address, "colAddr", fallbackCol),
    row: numberAttribute(address, "rowAddr", fallbackRow),
    colSpan: numberAttribute(span, "colSpan", 1),
    rowSpan: numberAttribute(span, "rowSpan", 1),
    text: textNodes.map((node) => collectText(childContent(node, "t") ?? [])).join("").replace(/\s+/g, " ").trim(),
  };
}

function parseTable(tableNode: OrderedNode, tableIndex: number): HwpxRow[] {
  const tableContent = childContent(tableNode, "tbl") ?? [];
  const rowNodes = findNodes(tableContent, "tr", { stopAt: "tbl" });
  return rowNodes.map((rowNode, rowIndex) => {
    const rowContent = childContent(rowNode, "tr") ?? [];
    const cellNodes = findNodes(rowContent, "tc", { stopAt: "tbl" });
    const cells = cellNodes
      .map((cellNode, cellIndex) => parseCell(cellNode, cellIndex, rowIndex))
      .sort((a, b) => a.col - b.col);
    return {
      sourceTableNo: tableIndex + 1,
      sourceRowNo: rowIndex + 1,
      cells,
      rawRowText: cells.map((cell) => cell.text).join(" | "),
    };
  });
}

export async function extractHwpxTablesFromBuffer(
  source: Uint8Array | ArrayBuffer,
): Promise<HwpxExtraction> {
  assertBulletinSourceSize(source.byteLength);
  const archive = await JSZip.loadAsync(source);
  assertSafeZipMetadata(archive);
  const outputBudget = createArchiveOutputBudget();
  const sectionFiles = Object.keys(archive.files)
    .filter((name) => /^Contents\/section\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (sectionFiles.length === 0) {
    throw new Error("HWPX Contents/section*.xml을 찾을 수 없습니다.");
  }

  const rows: HwpxRow[] = [];
  let tableCount = 0;
  for (const sectionFile of sectionFiles) {
    const entry = archive.file(sectionFile);
    if (!entry) continue;
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(
      await readLimitedZipEntry(entry, outputBudget),
    );
    const document = parser.parse(xml) as OrderedNode[];
    const tables = findNodes(document, "tbl");
    for (const table of tables) {
      rows.push(...parseTable(table, tableCount));
      tableCount += 1;
    }
  }

  return { sectionFiles, tableCount, rows };
}

export async function extractHwpxTables(filePath: string): Promise<HwpxExtraction> {
  return extractHwpxTablesFromBuffer(await readFile(filePath));
}
