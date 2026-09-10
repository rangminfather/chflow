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

function bearerToken(req: NextRequest) {
  const value = req.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get("ref")?.trim();
  const token = bearerToken(req);
  if (!ref) return NextResponse.json({ ok: false, error: "Bible reference is required." }, { status: 400 });
  if (!token) return NextResponse.json({ ok: false, error: "Authentication is required." }, { status: 401 });

  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  if (authError || !auth.user) {
    return NextResponse.json({ ok: false, error: "Invalid session." }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("parse_bible_reference", { p_ref: ref });
  const parsed = Array.isArray(data) ? data[0] as ParsedReference | undefined : undefined;
  if (error || !parsed) {
    return NextResponse.json({ ok: false, error: "Bible reference could not be parsed." }, { status: 400 });
  }

  const { data: object, error: storageError } = await r2.from("bible").getObject(nkrvBookPath(parsed.book_id));
  if (storageError || !object) {
    return NextResponse.json({ ok: false, error: "NKRV text is not available yet." }, { status: 503 });
  }

  let book: NkrvBook;
  try {
    book = JSON.parse(object.body.toString("utf8")) as NkrvBook;
  } catch {
    return NextResponse.json({ ok: false, error: "Stored NKRV text is invalid." }, { status: 500 });
  }
  if (book.version !== "NKRV" || book.bookId !== parsed.book_id || !Array.isArray(book.verses)) {
    return NextResponse.json({ ok: false, error: "Stored NKRV book does not match the request." }, { status: 500 });
  }

  const rows = selectNkrvPassage(
    book.verses,
    Number(parsed.chapter_start),
    parsed.verse_start == null ? null : Number(parsed.verse_start),
    parsed.chapter_end == null ? null : Number(parsed.chapter_end),
    parsed.verse_end == null ? null : Number(parsed.verse_end),
  );
  return NextResponse.json({
    ok: true,
    version: "NKRV",
    normalizedLabel: parsed.normalized_label,
    bookId: parsed.book_id,
    bookName: parsed.book_name,
    rows,
  }, { headers: { "Cache-Control": "private, max-age=300" } });
}
