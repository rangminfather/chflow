#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const here = dirname(fileURLToPath(import.meta.url));
const decoder = new TextDecoder("euc-kr");
// This licensed source has 31,101 logical verse slots. Eleven source lines
// merge adjacent verses and some headings continue the preceding verse.
const EXPECTED_LOGICAL_VERSES = 31101;

function loadEnvFile(envFile) {
  const envPath = envFile ? resolve(process.cwd(), envFile) : resolve(here, "../.env.local");
  for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index);
    if (!process.env[key]) process.env[key] = line.slice(index + 1).replace(/^"|"$/g, "");
  }
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function bookIdFromFilename(name) {
  const match = name.match(/^(\d+)-(\d+)/);
  if (!match) throw new Error(`Unexpected source filename: ${name}`);
  const testament = Number(match[1]);
  const order = Number(match[2]);
  if (testament === 1 && order >= 1 && order <= 39) return order;
  if (testament === 2 && order >= 1 && order <= 27) return 39 + order;
  throw new Error(`Unexpected source book number: ${name}`);
}

function stripHeading(value) {
  return value.replace(/^<[^>]+>\s*/, "").trim();
}

function parseBook(sourceDir, filename) {
  const bookId = bookIdFromFilename(filename);
  const verses = [];
  const notes = [];
  const lines = decoder.decode(readFileSync(join(sourceDir, filename))).split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const normal = line.match(/^[^\d]+(\d+):(\d+)(?:-(\d+))?\s+(.+)$/);
    if (normal) {
      const chapter = Number(normal[1]);
      const verse = Number(normal[2]);
      const endVerse = normal[3] ? Number(normal[3]) : undefined;
      verses.push({ chapter, verse, ...(endVerse ? { endVerse } : {}), text: normal[4].trim() });
      continue;
    }

    const continuation = line.match(/^[^\d]+(\d+):(.+)$/);
    if (!continuation) throw new Error(`Unparsed ${filename}:${index + 1}`);
    const chapter = Number(continuation[1]);
    const text = stripHeading(continuation[2]);
    const previous = verses.at(-1);
    // Standalone psalm/book labels have no verse text. Other malformed rows are
    // continuations of the immediately previous verse in this source edition.
    if (!text || (!/\s/.test(text) && text.length < 16)) {
      notes.push({ line: index + 1, type: "heading" });
      continue;
    }
    if (!previous || previous.chapter !== chapter) {
      throw new Error(`Continuation has no previous verse: ${filename}:${index + 1}`);
    }
    previous.text = `${previous.text} ${text}`;
    notes.push({ line: index + 1, type: "continuation", verse: previous.verse });
  }

  return { version: "NKRV", bookId, verses, notes };
}

function parseAll(sourceDir) {
  const files = readdirSync(sourceDir)
    .filter((name) => name.endsWith(".txt"))
    .sort((a, b) => bookIdFromFilename(a) - bookIdFromFilename(b));
  if (files.length !== 66) throw new Error(`Expected 66 source files, found ${files.length}.`);
  const books = files.map((name) => parseBook(sourceDir, name));
  const logicalVerses = books.flatMap((book) => book.verses)
    .reduce((total, row) => total + ((row.endVerse ?? row.verse) - row.verse + 1), 0);
  if (logicalVerses !== EXPECTED_LOGICAL_VERSES) {
    throw new Error(`Expected ${EXPECTED_LOGICAL_VERSES} logical verses, found ${logicalVerses}.`);
  }
  return books;
}

async function main() {
  loadEnvFile(arg("env-file"));
  const source = arg("source");
  const dryRun = process.argv.includes("--dry-run");
  if (!source) throw new Error("Usage: node scripts/import-nkrv-to-r2.mjs --source <directory> [--dry-run] [--env-file <path>]");
  const books = parseAll(resolve(process.cwd(), source));
  const entries = books.reduce((total, book) => total + book.verses.length, 0);
  const continuations = books.reduce((total, book) => total + book.notes.filter((note) => note.type === "continuation").length, 0);
  const headings = books.reduce((total, book) => total + book.notes.filter((note) => note.type === "heading").length, 0);
  console.log(JSON.stringify({ books: books.length, entries, logicalVerses: EXPECTED_LOGICAL_VERSES, continuations, headings }, null, 2));
  if (dryRun) return;

  const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
  if (required.some((key) => !process.env[key])) throw new Error("Missing R2 credentials.");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
    forcePathStyle: true,
  });
  const bucket = process.env.R2_BUCKET_NAME || "chflow-storage";
  await Promise.all(books.map(async (book) => {
    const key = `bible/NKRV/${String(book.bookId).padStart(2, "0")}.json`;
    const body = Buffer.from(JSON.stringify({ version: book.version, bookId: book.bookId, verses: book.verses }));
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "application/json; charset=utf-8" }));
    console.log(`uploaded ${key}`);
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
