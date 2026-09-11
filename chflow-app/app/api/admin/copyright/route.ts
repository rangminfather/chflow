// 저작권·라이선스 등록대장 — 관리자 전용 CRUD
// GET    /api/admin/copyright              목록
// POST   /api/admin/copyright              신규 등록 (multipart: 필드 + 증빙 이미지 파일 선택)
// PATCH  /api/admin/copyright              수정 (multipart: id 필수, 그 외 동일)
// DELETE /api/admin/copyright?id=...       삭제
//
// 항목 메타데이터는 Postgres RPC(get/upsert/delete_copyright_item)로 처리한다.
// 이 RPC들은 security definer 로 auth.uid() 기준 관리자 여부를 자체 검증하므로,
// 여기서는 로그인한 사용자의 토큰으로 RPC를 호출하고 에러 메시지로 상태코드만 매핑한다.
// 증빙 이미지 원본만 R2(copyright-evidence 버킷)에 별도 저장한다.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { r2 } from "@/lib/r2";
import {
  COPYRIGHT_EVIDENCE_BUCKET,
  COPYRIGHT_EVIDENCE_ALLOWED_TYPES,
  COPYRIGHT_EVIDENCE_MAX_BYTES,
  isCopyrightStatus,
  isLegacyPublicEvidencePath,
  fromRow,
} from "@/lib/copyright";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function tokenFrom(req: NextRequest) {
  const auth = req.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

async function callerClient(req: NextRequest) {
  const token = tokenFrom(req);
  if (token) {
    return createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll() {},
    },
  });
}

function apiError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

function statusFromRpcError(message: string): number {
  if (message.includes("로그인")) return 401;
  if (message.includes("권한") || message.includes("비밀번호")) return 403;
  if (message.includes("찾을 수 없습니다")) return 404;
  return 400;
}

export async function GET(req: NextRequest) {
  const client = await callerClient(req);
  const { data, error } = await client.rpc("get_copyright_items");
  if (error) return apiError(error.message, statusFromRpcError(error.message));
  return NextResponse.json({ ok: true, items: (data ?? []).map(fromRow) });
}

function parseFields(form: FormData) {
  const category = String(form.get("category") || "").trim();
  const assetName = String(form.get("asset_name") || "").trim();
  const rightsHolder = String(form.get("rights_holder") || "").trim();
  const status = String(form.get("status") || "");
  const scope = String(form.get("scope") || "").trim();
  const approvalMethod = String(form.get("approval_method") || "").trim();
  const approvalDateRaw = String(form.get("approval_date") || "").trim();
  const requiredNotice = String(form.get("required_notice") || "").trim();
  const notes = String(form.get("notes") || "").trim();
  const evidenceCaption = String(form.get("evidence_caption") || "").trim();
  const sortOrderRaw = String(form.get("sort_order") || "0").trim();
  const slugRaw = String(form.get("slug") || "").trim();

  if (!category) return { ok: false as const, error: "분류를 입력해 주세요" };
  if (category.length > 60) return { ok: false as const, error: "분류는 60자 이내로 입력해 주세요" };
  if (!assetName) return { ok: false as const, error: "대상 자료명을 입력해 주세요" };
  if (assetName.length > 200) return { ok: false as const, error: "대상 자료명은 200자 이내로 입력해 주세요" };
  if (!rightsHolder) return { ok: false as const, error: "저작권자·공급자를 입력해 주세요" };
  if (!isCopyrightStatus(status)) return { ok: false as const, error: "상태 값이 올바르지 않습니다" };

  const approvalDate = approvalDateRaw ? approvalDateRaw : null;
  if (approvalDate && !/^\d{4}-\d{2}-\d{2}$/.test(approvalDate)) {
    return { ok: false as const, error: "승인 일자 형식이 올바르지 않습니다 (YYYY-MM-DD)" };
  }

  const sortOrder = sortOrderRaw ? Number(sortOrderRaw) : 0;
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) {
    return { ok: false as const, error: "정렬 순서는 0~9999 사이의 숫자로 입력해 주세요" };
  }

  const slug = slugRaw ? slugRaw.toLowerCase() : "";
  if (slug && !/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(slug)) {
    return { ok: false as const, error: "코드명은 영문 소문자·숫자·하이픈만 사용할 수 있어요" };
  }

  return {
    ok: true as const,
    category, assetName, rightsHolder, status, scope, approvalMethod, approvalDate,
    requiredNotice, notes, evidenceCaption, sortOrder, slug,
  };
}

function validateEvidenceFile(file: File) {
  if (!COPYRIGHT_EVIDENCE_ALLOWED_TYPES.includes(file.type)) {
    return "증빙 이미지는 PNG·JPEG·WEBP 파일만 올릴 수 있습니다";
  }
  if (file.size <= 0) return "빈 파일은 올릴 수 없습니다";
  if (file.size > COPYRIGHT_EVIDENCE_MAX_BYTES) return "증빙 이미지는 8MB 이하만 올릴 수 있습니다";
  return null;
}

function extFromType(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

export async function POST(req: NextRequest) {
  const client = await callerClient(req);
  const form = await req.formData();
  const fields = parseFields(form);
  if (!fields.ok) return apiError(fields.error, 400);

  let evidenceImagePath: string | null = null;
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    const fileError = validateEvidenceFile(file);
    if (fileError) return apiError(fileError, fileError.includes("8MB") ? 413 : 415);
    evidenceImagePath = `${Date.now()}-${crypto.randomUUID()}.${extFromType(file.type)}`;
    const uploaded = await r2.from(COPYRIGHT_EVIDENCE_BUCKET).upload(
      evidenceImagePath,
      await file.arrayBuffer(),
      { contentType: file.type, upsert: false }
    );
    if (uploaded.error) return apiError("증빙 이미지 업로드에 실패했습니다", 500);
  }

  const { data, error } = await client.rpc("upsert_copyright_item", {
    p_id: null,
    p_category: fields.category,
    p_asset_name: fields.assetName,
    p_rights_holder: fields.rightsHolder,
    p_status: fields.status,
    p_scope: fields.scope || null,
    p_approval_method: fields.approvalMethod || null,
    p_approval_date: fields.approvalDate,
    p_required_notice: fields.requiredNotice || null,
    p_notes: fields.notes || null,
    p_evidence_image_path: evidenceImagePath,
    p_evidence_caption: fields.evidenceCaption || null,
    p_sort_order: fields.sortOrder,
    p_slug: fields.slug || null,
  });
  if (error) {
    if (evidenceImagePath) await r2.from(COPYRIGHT_EVIDENCE_BUCKET).remove([evidenceImagePath]);
    return apiError(error.message, statusFromRpcError(error.message));
  }

  return NextResponse.json({ ok: true, item: fromRow(data) });
}

export async function PATCH(req: NextRequest) {
  const client = await callerClient(req);
  const form = await req.formData();
  const id = String(form.get("id") || "");
  if (!id) return apiError("수정할 항목 ID가 없습니다", 400);

  const pin = String(form.get("pin") || "");
  if (!pin) return apiError("관리자 비밀번호를 입력해 주세요", 403);

  const fields = parseFields(form);
  if (!fields.ok) return apiError(fields.error, 400);

  const { data: existingRows, error: existingError } = await client.rpc("get_copyright_items");
  if (existingError) return apiError(existingError.message, statusFromRpcError(existingError.message));
  const existing = (existingRows ?? []).map(fromRow).find((row: { id: string }) => row.id === id);
  if (!existing) return apiError("수정할 항목을 찾을 수 없습니다", 404);

  const removeEvidence = form.get("remove_evidence") === "1";
  let evidenceImagePath = existing.evidenceImagePath;
  let evidenceCaption = fields.evidenceCaption || null;
  const newFile = form.get("file");
  let uploadedPath: string | null = null;

  if (newFile instanceof File && newFile.size > 0) {
    const fileError = validateEvidenceFile(newFile);
    if (fileError) return apiError(fileError, fileError.includes("8MB") ? 413 : 415);
    uploadedPath = `${Date.now()}-${crypto.randomUUID()}.${extFromType(newFile.type)}`;
    const uploaded = await r2.from(COPYRIGHT_EVIDENCE_BUCKET).upload(
      uploadedPath,
      await newFile.arrayBuffer(),
      { contentType: newFile.type, upsert: false }
    );
    if (uploaded.error) return apiError("증빙 이미지 업로드에 실패했습니다", 500);
    evidenceImagePath = uploadedPath;
  } else if (removeEvidence) {
    evidenceImagePath = null;
    evidenceCaption = null;
  }

  const { data, error } = await client.rpc("upsert_copyright_item", {
    p_id: id,
    p_category: fields.category,
    p_asset_name: fields.assetName,
    p_rights_holder: fields.rightsHolder,
    p_status: fields.status,
    p_scope: fields.scope || null,
    p_approval_method: fields.approvalMethod || null,
    p_approval_date: fields.approvalDate,
    p_required_notice: fields.requiredNotice || null,
    p_notes: fields.notes || null,
    p_evidence_image_path: evidenceImagePath,
    p_evidence_caption: evidenceCaption,
    p_sort_order: fields.sortOrder,
    p_admin_pin: pin,
    p_slug: fields.slug || null,
  });
  if (error) {
    if (uploadedPath) await r2.from(COPYRIGHT_EVIDENCE_BUCKET).remove([uploadedPath]);
    return apiError(error.message, statusFromRpcError(error.message));
  }

  // 새 이미지로 교체됐거나 명시적으로 제거된 경우, 기존 R2 오브젝트 정리 (레거시 public 경로는 건드리지 않음)
  const oldPath = existing.evidenceImagePath;
  if (oldPath && oldPath !== evidenceImagePath && !isLegacyPublicEvidencePath(oldPath)) {
    await r2.from(COPYRIGHT_EVIDENCE_BUCKET).remove([oldPath]);
  }

  return NextResponse.json({ ok: true, item: fromRow(data) });
}

export async function DELETE(req: NextRequest) {
  const client = await callerClient(req);
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!id) return apiError("삭제할 항목 ID가 없습니다", 400);

  // 비밀번호는 URL(쿼리스트링)에 남기지 않고 본문으로만 받는다
  const body = await req.json().catch(() => null) as { pin?: string } | null;
  const pin = body?.pin || "";
  if (!pin) return apiError("관리자 비밀번호를 입력해 주세요", 403);

  const { data, error } = await client.rpc("delete_copyright_item", { p_id: id, p_admin_pin: pin });
  if (error) return apiError(error.message, statusFromRpcError(error.message));

  const deleted = fromRow(data);
  if (deleted.evidenceImagePath && !isLegacyPublicEvidencePath(deleted.evidenceImagePath)) {
    await r2.from(COPYRIGHT_EVIDENCE_BUCKET).remove([deleted.evidenceImagePath]);
  }

  return NextResponse.json({ ok: true });
}
