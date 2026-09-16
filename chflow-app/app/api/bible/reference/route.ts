import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { r2 } from "@/lib/r2";
import { nkrvBookPath, selectNkrvPassage, type NkrvBook } from "@/lib/bible/nkrvR2";

export const runtime = "nodejs";
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type ParsedReference = {
  book_id: number;
  book_name: string;
  chapter_start: number;
  verse_start: number | null;
  chapter_end: number | null;
  verse_end: number | null;
  normalized_label: string;
};

type CachedBook = {
  book: NkrvBook;
  bytes: number;
};

// The reader switches chapters much more often than it switches books. Keep a
// small per-instance cache so a warm server does not download and parse the
// same R2 object for every chapter turn.
const BOOK_CACHE_LIMIT = 8;
const bookCache = new Map<number, CachedBook>();

function getCachedBook(bookId: number) {
  const cached = bookCache.get(bookId);
  if (!cached) return null;
  bookCache.delete(bookId);
  bookCache.set(bookId, cached);
  return cached;
}

function cacheBook(bookId: number, cached: CachedBook) {
  bookCache.set(bookId, cached);
  if (bookCache.size > BOOK_CACHE_LIMIT) {
    const oldest = bookCache.keys().next().value;
    if (oldest !== undefined) bookCache.delete(oldest);
  }
}

function duration(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
}

function timingHeader(parts: Record<string, number | string>) {
  return Object.entries(parts)
    .map(([name, value]) => typeof value === "number" ? `${name};dur=${value}` : `${name};desc=\"${value}\"`)
    .join(", ");
}

function bearerToken(req: NextRequest) {
  const value = req.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const timings: Record<string, number | string> = {};
  const ref = req.nextUrl.searchParams.get("ref")?.trim();
  const requestedBookId = Number(req.nextUrl.searchParams.get("bookId"));
  const requestedChapter = Number(req.nextUrl.searchParams.get("chapter"));
  const isChapterRequest = Number.isInteger(requestedBookId) && requestedBookId > 0
    && Number.isInteger(requestedChapter) && requestedChapter > 0;
  const token = bearerToken(req);
  if (!ref && !isChapterRequest) return NextResponse.json({ ok: false, error: "Bible reference is required." }, { status: 400 });
  if (!token) return NextResponse.json({ ok: false, error: "Authentication is required." }, { status: 401 });

  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authStartedAt = Date.now();
  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  timings.auth = duration(authStartedAt);
  if (authError || !auth.user) {
    return NextResponse.json({ ok: false, error: "Invalid session." }, { status: 401 });
  }

  let parsed: ParsedReference | undefined;
  if (!isChapterRequest) {
    const parseStartedAt = Date.now();
    const { data, error } = await supabase.rpc("parse_bible_reference", { p_ref: ref! });
    timings.parse = duration(parseStartedAt);
    parsed = Array.isArray(data) ? data[0] as ParsedReference | undefined : undefined;
    if (error || !parsed) {
      return NextResponse.json({ ok: false, error: "Bible reference could not be parsed." }, { status: 400 });
    }
  }

  const bookId = isChapterRequest ? requestedBookId : parsed!.book_id;
  let cached = getCachedBook(bookId);
  if (!cached) {
    const storageStartedAt = Date.now();
    const { data: object, error: storageError } = await r2.from("bible").getObject(nkrvBookPath(bookId));
    timings.r2 = duration(storageStartedAt);
    if (storageError || !object) {
      return NextResponse.json({ ok: false, error: "NKRV text is not available yet." }, { status: 503 });
    }

    const parseStartedAt = Date.now();
    let book: NkrvBook;
    try {
      book = JSON.parse(object.body.toString("utf8")) as NkrvBook;
    } catch {
      return NextResponse.json({ ok: false, error: "Stored NKRV text is invalid." }, { status: 500 });
    }
    timings.json = duration(parseStartedAt);
    if (book.version !== "NKRV" || book.bookId !== bookId || !Array.isArray(book.verses)) {
      return NextResponse.json({ ok: false, error: "Stored NKRV book does not match the request." }, { status: 500 });
    }
    cached = { book, bytes: object.contentLength };
    cacheBook(bookId, cached);
  }

  timings.book_cache = timings.r2 === undefined ? "hit" : "miss";
  const selectStartedAt = Date.now();
  const rows = selectNkrvPassage(
    cached.book.verses,
    isChapterRequest ? requestedChapter : Number(parsed!.chapter_start),
    isChapterRequest ? null : parsed!.verse_start == null ? null : Number(parsed!.verse_start),
    isChapterRequest ? null : parsed!.chapter_end == null ? null : Number(parsed!.chapter_end),
    isChapterRequest ? null : parsed!.verse_end == null ? null : Number(parsed!.verse_end),
  );
  timings.select = duration(selectStartedAt);
  timings.total = duration(startedAt);
  return NextResponse.json({
    ok: true,
    version: "NKRV",
    normalizedLabel: parsed?.normalized_label ?? null,
    bookId,
    bookName: parsed?.book_name ?? null,
    rows,
  }, { headers: {
    "Cache-Control": "private, max-age=300",
    "Server-Timing": timingHeader(timings),
    "X-Bible-Book-Cache": timings.book_cache,
    "X-Bible-Book-Bytes": String(cached.bytes),
  } });
}
