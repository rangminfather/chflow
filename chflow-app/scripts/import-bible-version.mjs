#!/usr/bin/env node
/* ============================================================
   성경 역본 본문 적재

   사용 허락을 받은 역본의 절 데이터를 bible_verses 에 넣는다.
   개역한글(KRV)은 이미 들어 있고, 이 스크립트는 개역개정(NKRV) 처럼
   나중에 허락받아 추가하는 역본용이다.

   쓰는 법
     node scripts/import-bible-version.mjs --version NKRV --file ./nkrv.json
     node scripts/import-bible-version.mjs --version NKRV --file ./nkrv.json --activate

   입력 파일 (JSON 배열) — 둘 중 아무 형태나 된다
     [{ "book_id": 1, "chapter": 1, "verse": 1, "text": "태초에 ..." }, ...]
     [{ "book": "창세기", "chapter": 1, "verse": 1, "text": "태초에 ..." }, ...]

   · book 이름으로 줄 경우 bible_books 의 name_ko / short_names 로 맞춘다
   · 같은 절이 이미 있으면 덮어쓴다 (upsert)
   · --activate 를 주면 다 넣은 뒤 그 역본을 화면에 노출시킨다

   환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
   (chflow-app/.env.local 을 자동으로 읽는다)
   ============================================================ */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const path = resolve(here, "../.env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  loadEnvLocal();
  const versionCode = (arg("version") || "").toUpperCase();
  const filePath = arg("file");
  const activate = process.argv.includes("--activate");

  if (!versionCode || !filePath) {
    console.error("사용법: node scripts/import-bible-version.mjs --version NKRV --file ./nkrv.json [--activate]");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // 역본이 등록돼 있어야 한다 (마이그레이션에서 미리 만들어 둔다)
  const { data: version, error: versionError } = await supabase
    .from("bible_versions")
    .select("code, name_ko, is_active")
    .eq("code", versionCode)
    .maybeSingle();
  if (versionError) throw versionError;
  if (!version) {
    console.error(`bible_versions 에 '${versionCode}' 가 없습니다. 마이그레이션으로 먼저 등록하세요.`);
    process.exit(1);
  }

  const { data: books, error: bookError } = await supabase
    .from("bible_books")
    .select("book_id, name_ko, short_names");
  if (bookError) throw bookError;
  const byName = new Map();
  for (const book of books) {
    byName.set(book.name_ko, book.book_id);
    for (const alias of book.short_names || []) byName.set(alias, book.book_id);
  }

  const rows = JSON.parse(readFileSync(resolve(process.cwd(), filePath), "utf8"));
  if (!Array.isArray(rows)) throw new Error("입력 파일은 JSON 배열이어야 합니다");

  const verses = [];
  const unknownBooks = new Set();
  for (const row of rows) {
    const bookId = row.book_id ?? byName.get(String(row.book || "").trim());
    if (!bookId) { unknownBooks.add(String(row.book)); continue; }
    const chapter = Number(row.chapter);
    const verse = Number(row.verse);
    const text = String(row.text ?? "").trim();
    if (!chapter || !verse || !text) continue;
    verses.push({ version_code: versionCode, book_id: bookId, chapter, verse, text });
  }

  if (unknownBooks.size) {
    console.error("알 수 없는 책 이름:", [...unknownBooks].slice(0, 10).join(", "));
    console.error("bible_books 의 name_ko / short_names 와 맞춰 주세요. 중단합니다.");
    process.exit(1);
  }
  console.log(`${version.name_ko}(${versionCode}) — 넣을 절 ${verses.length.toLocaleString()}개`);

  const CHUNK = 1000;
  let done = 0;
  for (let i = 0; i < verses.length; i += CHUNK) {
    const chunk = verses.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("bible_verses")
      .upsert(chunk, { onConflict: "version_code,book_id,chapter,verse" });
    if (error) throw error;
    done += chunk.length;
    process.stdout.write(`\r  적재 ${done.toLocaleString()} / ${verses.length.toLocaleString()}`);
  }
  process.stdout.write("\n");

  const { count } = await supabase
    .from("bible_verses")
    .select("*", { count: "exact", head: true })
    .eq("version_code", versionCode);
  console.log(`DB 확인: ${versionCode} ${Number(count).toLocaleString()}절`);

  if (activate) {
    const { error } = await supabase
      .from("bible_versions")
      .update({ is_active: true })
      .eq("code", versionCode);
    if (error) throw error;
    console.log(`${versionCode} 를 화면에 노출시켰습니다 (is_active = true).`);
  } else if (!version.is_active) {
    console.log(`아직 화면에는 안 나옵니다. 확인 후 --activate 로 켜거나 직접 is_active 를 바꾸세요.`);
  }
}

main().catch((e) => {
  console.error("\n실패:", e.message || e);
  process.exit(1);
});
