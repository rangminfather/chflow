import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { extractNativeBulletinText, extractOcrBulletinText } from "@/lib/bulletin/content-extraction";
import { syncDeptBulletinFor } from "@/lib/bulletin/dept-bulletin-sync";
import { r2 } from "@/lib/r2";

export const runtime = "nodejs";
export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = "bulletins";

type BulletinRow = {
  id: string;
  title: string;
  sunday_date: string;
  pdf_url: string | null;
};

function tokenFrom(request: NextRequest) {
  const value = request.headers.get("Authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

async function requireUser(request: NextRequest) {
  const token = tokenFrom(request);
  if (!token) return false;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  return !error && !!data.user;
}

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

function deptMarker(deptKey: string) {
  return `Dept bulletin: ${deptKey}`;
}

function isImagePath(path: string) {
  return /\.(?:jpe?g|png|gif|webp|bmp)$/i.test(path);
}

async function loadBulletinForDept(deptKey: string, issueDate: string) {
  const { data, error } = await admin()
    .from("bulletins")
    .select("id,title,sunday_date,pdf_url")
    .eq("sunday_date", issueDate)
    .ilike("content", `%${deptMarker(deptKey)}%`)
    .not("pdf_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as BulletinRow | null;
}

async function loadBulletinById(id: string) {
  const { data, error } = await admin().from("bulletins").select("id,title,sunday_date,pdf_url").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as BulletinRow | null;
}

async function cachedExtraction(bulletinId: string) {
  const { data, error } = await admin()
    .from("dept_bulletin_extractions")
    .select("extracted_text,fields,extraction_method")
    .eq("bulletin_id", bulletinId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { extracted_text: string; fields: Record<string, string>; extraction_method: "native" | "ocr" } | null;
}

async function saveExtraction(bulletinId: string, extraction: { text: string; fields: Record<string, string>; method: "native" | "ocr" }) {
  const { error } = await admin().from("dept_bulletin_extractions").upsert({
    bulletin_id: bulletinId,
    extracted_text: extraction.text,
    fields: extraction.fields,
    extraction_method: extraction.method,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

function response(bulletin: BulletinRow, payload: {
  status: "ready" | "ocr_required";
  fields?: Record<string, string>;
  method?: "native" | "ocr";
}) {
  const path = bulletin.pdf_url || "";
  return NextResponse.json({
    ok: true,
    bulletin: { id: bulletin.id, title: bulletin.title, issue_date: bulletin.sunday_date },
    ...payload,
    file_url: `/api/storage/${BUCKET}/${path}?stream=1`,
  });
}

export async function GET(request: NextRequest) {
  try {
    if (!await requireUser(request)) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });
    const url = new URL(request.url);
    const deptKey = url.searchParams.get("dept") || "";
    const issueDate = url.searchParams.get("date") || "";
    if (!deptKey || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
      return NextResponse.json({ ok: false, error: "Invalid bulletin request" }, { status: 400 });
    }
    let bulletin = await loadBulletinForDept(deptKey, issueDate);
    // 주보보기를 먼저 열지 않았더라도 공통 파이프라인의 첫 요청이 수집을 시도한다.
    if (!bulletin) {
      await syncDeptBulletinFor(deptKey);
      bulletin = await loadBulletinForDept(deptKey, issueDate);
    }
    if (!bulletin?.pdf_url) return NextResponse.json({ ok: true, status: "missing" });

    const cached = await cachedExtraction(bulletin.id);
    if (cached) return response(bulletin, { status: "ready", fields: cached.fields, method: cached.extraction_method });
    if (isImagePath(bulletin.pdf_url)) return response(bulletin, { status: "ocr_required" });

    const file = await r2.from(BUCKET).download(bulletin.pdf_url);
    if (file.error || !file.data) throw file.error || new Error("bulletin_file_missing");
    const extraction = await extractNativeBulletinText(new Uint8Array(await file.data.arrayBuffer()), bulletin.pdf_url);
    if (extraction.needsOcr) return response(bulletin, { status: "ocr_required" });
    await saveExtraction(bulletin.id, extraction);
    return response(bulletin, { status: "ready", fields: extraction.fields, method: extraction.method });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "bulletin_extraction_failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!await requireUser(request)) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });
    const body = await request.json() as { bulletin_id?: string; text?: string };
    const bulletinId = body.bulletin_id || "";
    const text = body.text?.trim() || "";
    if (!bulletinId || !text || text.length > 200_000) {
      return NextResponse.json({ ok: false, error: "Invalid OCR result" }, { status: 400 });
    }
    const bulletin = await loadBulletinById(bulletinId);
    if (!bulletin?.pdf_url || !isImagePath(bulletin.pdf_url)) {
      return NextResponse.json({ ok: false, error: "OCR source unavailable" }, { status: 404 });
    }
    const extraction = extractOcrBulletinText(text);
    await saveExtraction(bulletin.id, extraction);
    return response(bulletin, { status: "ready", fields: extraction.fields, method: "ocr" });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "ocr_result_save_failed" }, { status: 500 });
  }
}
