import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";
import { r2 } from "@/lib/r2";
import { findBulletinScriptureCandidates, type BulletinServiceType } from "@/lib/bulletin/scripture-parser";
import { validateNkrvReference } from "@/lib/bulletin/scripture-validation";

export const runtime = "nodejs";
export const maxDuration = 30;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type Candidate = { serviceType: BulletinServiceType; rawReference: string; confidence: number };
function token(req: NextRequest) { const value = req.headers.get("authorization") || ""; return value.startsWith("Bearer ") ? value.slice(7) : null; }
async function actor(req: NextRequest) {
  const accessToken = token(req); if (!accessToken) return null;
  const userDb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${accessToken}` } }, auth: { persistSession: false } });
  const { data: auth } = await userDb.auth.getUser(accessToken); if (!auth.user) return null;
  const admin = createClient<any>(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  const { data: profile } = await admin.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  return ["admin", "office", "pastor"].includes(profile?.role || "") ? { userDb, admin, userId: auth.user.id } : null;
}
async function saveCandidates(admin: any, bulletinId: string, candidates: Candidate[], source: "pdf_text" | "ocr", userId: string) {
  const rows = [];
  for (const candidate of candidates) {
    try {
      const valid = await validateNkrvReference(admin, candidate.rawReference);
      rows.push({ bulletin_id: bulletinId, service_type: candidate.serviceType, book_id: valid.bookId, chapter_start: valid.chapterStart, verse_start: valid.verseStart, chapter_end: valid.chapterEnd, verse_end: valid.verseEnd, raw_reference: candidate.rawReference, normalized_label: valid.normalizedLabel, source, confidence: candidate.confidence, status: "pending", sort_order: 0, verified_at: null, verified_by: null, updated_at: new Date().toISOString() });
    } catch { /* invalid candidates are intentionally not auto-saved */ }
  }
  if (rows.length) await admin.from("bulletin_scripture_readings").upsert(rows, { onConflict: "bulletin_id,service_type,sort_order" });
  return rows.length;
}

export async function GET(req: NextRequest) {
  const session = await actor(req); if (!session) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const bulletinId = new URL(req.url).searchParams.get("bulletin_id");
  if (bulletinId) {
    const { data, error } = await session.admin.from("bulletin_scripture_readings").select("*").eq("bulletin_id", bulletinId).order("service_type").order("sort_order");
    return NextResponse.json({ ok: !error, readings: data || [], error: error?.message });
  }
  const { data, error } = await session.admin.from("bulletins").select("id,title,sunday_date,pdf_url").not("pdf_url", "is", null).ilike("content", "%UMS jubo no:%").order("sunday_date", { ascending: false }).limit(20);
  return NextResponse.json({ ok: !error, bulletins: data || [], error: error?.message });
}

export async function POST(req: NextRequest) {
  const session = await actor(req); if (!session) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const body = await req.json() as { action?: string; bulletin_id?: string; candidates?: Candidate[]; reading?: Candidate & { status?: "pending" | "verified" | "rejected" } };
  const bulletinId = body.bulletin_id || ""; if (!bulletinId) return NextResponse.json({ ok: false, error: "bulletin_id is required" }, { status: 400 });
  if (body.action === "analyze_native") {
    const { data: bulletin } = await session.admin.from("bulletins").select("pdf_url").eq("id", bulletinId).maybeSingle();
    if (!bulletin?.pdf_url) return NextResponse.json({ ok: false, error: "PDF not found" }, { status: 404 });
    const file = await r2.from("bulletins").download(bulletin.pdf_url);
    if (file.error || !file.data) return NextResponse.json({ ok: false, error: "PDF could not be downloaded" }, { status: 502 });
    const doc = await getDocumentProxy(new Uint8Array(await file.data.arrayBuffer()));
    const result = await extractText(doc);
    const firstPage = Array.isArray(result.text) ? result.text[0] || "" : "";
    const saved = await saveCandidates(session.admin, bulletinId, findBulletinScriptureCandidates(firstPage), "pdf_text", session.userId);
    return NextResponse.json({ ok: true, native_text: firstPage, saved, needs_ocr: saved < 4 });
  }
  if (body.action === "save_ocr_candidates" && Array.isArray(body.candidates)) {
    const saved = await saveCandidates(session.admin, bulletinId, body.candidates, "ocr", session.userId);
    return NextResponse.json({ ok: true, saved });
  }
  if (body.action === "save_reading" && body.reading) {
    let valid;
    try { valid = await validateNkrvReference(session.admin, body.reading.rawReference); }
    catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "성경 본문 검증 실패" }, { status: 400 }); }
    const status = body.reading.status || "pending";
    const row = { bulletin_id: bulletinId, service_type: body.reading.serviceType, book_id: valid.bookId, chapter_start: valid.chapterStart, verse_start: valid.verseStart, chapter_end: valid.chapterEnd, verse_end: valid.verseEnd, raw_reference: body.reading.rawReference, normalized_label: valid.normalizedLabel, source: "manual", confidence: 1, status, sort_order: 0, verified_at: status === "verified" ? new Date().toISOString() : null, verified_by: status === "verified" ? session.userId : null, updated_at: new Date().toISOString() };
    const { error } = await session.admin.from("bulletin_scripture_readings").upsert(row, { onConflict: "bulletin_id,service_type,sort_order" });
    return NextResponse.json({ ok: !error, error: error?.message });
  }
  return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
}
