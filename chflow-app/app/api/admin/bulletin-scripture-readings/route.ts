import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isBulletinServiceType, splitScriptureReferences, type BulletinServiceType } from "@/lib/bulletin/scripture-parser";
import { validateNkrvReference } from "@/lib/bulletin/scripture-validation";
import { runScriptureExtraction } from "@/lib/bulletin/scripture-auto";

export const runtime = "nodejs";
export const maxDuration = 60;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function token(req: NextRequest) { const value = req.headers.get("authorization") || ""; return value.startsWith("Bearer ") ? value.slice(7) : null; }
async function actor(req: NextRequest) {
  const accessToken = token(req); if (!accessToken) return null;
  const userDb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${accessToken}` } }, auth: { persistSession: false } });
  const { data: auth } = await userDb.auth.getUser(accessToken); if (!auth.user) return null;
  const admin = createClient<any>(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  const { data: profile } = await admin.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  return ["admin", "office", "pastor"].includes(profile?.role || "") ? { admin, userId: auth.user.id } : null;
}

/** 관리자가 직접 입력한 칸: 기존 행을 모두 지우고 검증된 본문으로 바꾼다. 빈 값이면 칸을 비운다. */
async function saveSlot(admin: any, userId: string, bulletinId: string, serviceType: BulletinServiceType, value: string) {
  const references = splitScriptureReferences(value);
  const validated = [];
  for (const reference of references) {
    try { validated.push({ reference, valid: await validateNkrvReference(admin, reference) }); }
    catch (error) { throw new Error(`${reference}: ${error instanceof Error ? error.message : "성경 본문 검증 실패"}`); }
  }
  const { error: deleteError } = await admin.from("bulletin_scripture_readings").delete().eq("bulletin_id", bulletinId).eq("service_type", serviceType);
  if (deleteError) throw new Error(deleteError.message);
  if (!validated.length) return;
  const now = new Date().toISOString();
  const { error } = await admin.from("bulletin_scripture_readings").insert(validated.map(({ reference, valid }, index) => ({
    bulletin_id: bulletinId, service_type: serviceType, book_id: valid.bookId, chapter_start: valid.chapterStart, verse_start: valid.verseStart,
    chapter_end: valid.chapterEnd, verse_end: valid.verseEnd, raw_reference: reference, normalized_label: valid.normalizedLabel,
    source: "manual", confidence: 1, status: "verified", sort_order: index, verified_at: now, verified_by: userId, updated_at: now,
  })));
  if (error) throw new Error(error.message);
}

/** 검토 대기 중인 자동 판독을 그대로 승인. 성경에 없는 구절이 섞인 칸은 승인하지 않는다. */
async function approveSlots(admin: any, userId: string, bulletinId: string, serviceTypes: BulletinServiceType[]) {
  const { data, error } = await admin.from("bulletin_scripture_readings").select("service_type,book_id,status").eq("bulletin_id", bulletinId).in("service_type", serviceTypes);
  if (error) throw new Error(error.message);
  const approvable = serviceTypes.filter((type) => {
    const rows = (data || []).filter((row: { service_type: string }) => row.service_type === type);
    return rows.length > 0 && rows.every((row: { book_id: number | null }) => row.book_id != null) && rows.some((row: { status: string }) => row.status === "pending");
  });
  if (!approvable.length) return [];
  const now = new Date().toISOString();
  const { error: updateError } = await admin.from("bulletin_scripture_readings")
    .update({ status: "verified", verified_at: now, verified_by: userId, updated_at: now })
    .eq("bulletin_id", bulletinId).in("service_type", approvable).eq("status", "pending");
  if (updateError) throw new Error(updateError.message);
  return approvable;
}

export async function GET(req: NextRequest) {
  const session = await actor(req); if (!session) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const bulletinId = new URL(req.url).searchParams.get("bulletin_id");
  if (bulletinId) {
    const [{ data, error }, { data: extraction }] = await Promise.all([
      session.admin.from("bulletin_scripture_readings").select("*").eq("bulletin_id", bulletinId).order("service_type").order("sort_order"),
      session.admin.from("bulletin_scripture_extractions").select("status,attempts,model_results,last_error,updated_at").eq("bulletin_id", bulletinId).maybeSingle(),
    ]);
    return NextResponse.json({ ok: !error, readings: data || [], extraction: extraction || null, error: error?.message });
  }
  const { data, error } = await session.admin.from("bulletins").select("id,title,sunday_date,pdf_url").not("pdf_url", "is", null).ilike("content", "%UMS jubo no:%").order("sunday_date", { ascending: false }).limit(20);
  const ids = (data || []).map((row: { id: string }) => row.id);
  const { data: states } = ids.length
    ? await session.admin.from("bulletin_scripture_extractions").select("bulletin_id,status").in("bulletin_id", ids)
    : { data: [] };
  const statusById = new Map((states || []).map((row: { bulletin_id: string; status: string }) => [row.bulletin_id, row.status]));
  return NextResponse.json({ ok: !error, bulletins: (data || []).map((row: { id: string }) => ({ ...row, extraction_status: statusById.get(row.id) ?? null })), error: error?.message });
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const session = await actor(req); if (!session) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const body = await req.json() as { action?: string; bulletin_id?: string; service_type?: string; service_types?: string[]; references?: string };
  const bulletinId = body.bulletin_id || ""; if (!bulletinId) return NextResponse.json({ ok: false, error: "bulletin_id is required" }, { status: 400 });
  try {
    if (body.action === "extract_ai") {
      const result = await runScriptureExtraction(session.admin, bulletinId, { deadline: startedAt + (maxDuration - 5) * 1000, force: true });
      return NextResponse.json({ ok: true, status: result.status, errors: result.errors });
    }
    if (body.action === "save_slot" && isBulletinServiceType(body.service_type)) {
      await saveSlot(session.admin, session.userId, bulletinId, body.service_type, body.references || "");
      return NextResponse.json({ ok: true });
    }
    if (body.action === "approve" && Array.isArray(body.service_types) && body.service_types.every(isBulletinServiceType)) {
      const approved = await approveSlots(session.admin, session.userId, bulletinId, body.service_types as BulletinServiceType[]);
      return NextResponse.json({ ok: true, approved });
    }
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "처리 실패" }, { status: 400 });
  }
  return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
}
