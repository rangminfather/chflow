import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { r2 } from "@/lib/r2";
import {
  EDUCATION_MATERIAL_MAX_BYTES,
  EDUCATION_MATERIALS_BUCKET,
  isEducationMaterial,
  isEducationMaterialKind,
  isEducationMaterialManagerGrade,
  isEducationMaterialViewerGrade,
  sortEducationMaterials,
  type EducationMaterial,
  type EducationMaterialKind,
} from "@/lib/educationMaterials";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function tokenFrom(req: NextRequest) {
  const auth = req.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function userClient(token: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function verifyAccess(req: NextRequest, deptId: string) {
  if (!UUID_RE.test(deptId)) {
    return { ok: false as const, status: 400, error: "잘못된 부서입니다" };
  }

  const token = tokenFrom(req);
  const client = token
    ? userClient(token)
    : createServerClient(SUPABASE_URL, ANON_KEY, {
      cookies: {
        getAll: async () => (await cookies()).getAll(),
        setAll() {},
      },
    });
  const { data: authData, error: authError } = token
    ? await client.auth.getUser(token)
    : await client.auth.getUser();
  if (authError || !authData.user) {
    return { ok: false as const, status: 401, error: "로그인이 만료되었습니다" };
  }

  const [
    { data: allowed, error: allowedError },
    { data: gradeData, error: gradeError },
    { data: dept, error: deptError },
  ] = await Promise.all([
    client.rpc("is_edu_member_or_admin", { p_dept_id: deptId }),
    client.rpc("get_user_grade", { p_dept_id: deptId }),
    adminClient().from("departments").select("id,name,category").eq("id", deptId).maybeSingle(),
  ]);
  if (allowedError || allowed !== true) {
    return { ok: false as const, status: 403, error: "이 부서의 구성원만 사용할 수 있습니다" };
  }
  const grade = typeof gradeData === "number" ? gradeData : Number(gradeData);
  if (gradeError || !Number.isFinite(grade) || grade < 0 || grade > 4) {
    return { ok: false as const, status: 403, error: "부서 접근 권한이 없습니다" };
  }
  if (!isEducationMaterialViewerGrade(grade)) {
    return { ok: false as const, status: 403, error: "교사 이상만 교육자료를 볼 수 있습니다" };
  }
  if (deptError || !dept || dept.category !== "교육사역국") {
    return { ok: false as const, status: 403, error: "교육부서에서만 사용할 수 있습니다" };
  }

  return {
    ok: true as const,
    userId: authData.user.id,
    grade,
    deptName: dept.name as string,
    canManage: isEducationMaterialManagerGrade(grade),
  };
}

function metadataPath(deptId: string, materialId: string) {
  return `${deptId}/${materialId}.json`;
}

async function readMaterial(deptId: string, materialId: string): Promise<EducationMaterial | null> {
  if (!UUID_RE.test(materialId)) return null;
  const { data, error } = await r2.from(EDUCATION_MATERIALS_BUCKET).getObject(metadataPath(deptId, materialId));
  if (error || !data) return null;
  try {
    const parsed: unknown = JSON.parse(data.body.toString("utf8"));
    return isEducationMaterial(parsed) && parsed.deptId === deptId && parsed.id === materialId ? parsed : null;
  } catch {
    return null;
  }
}

async function writeMaterial(material: EducationMaterial) {
  const body = Buffer.from(JSON.stringify(material), "utf8");
  return r2.from(EDUCATION_MATERIALS_BUCKET).upload(metadataPath(material.deptId, material.id), body, {
    contentType: "application/json; charset=utf-8",
    upsert: true,
  });
}

function parseFields(form: FormData) {
  const title = String(form.get("title") || "").trim();
  const kindValue = String(form.get("kind") || "");
  const lessonNumberValue = String(form.get("lesson_number") || "").trim();
  const sortOrderValue = String(form.get("sort_order") || "").trim();

  if (!title || title.length > 120) return { ok: false as const, error: "제목은 1~120자로 입력해 주세요" };
  if (!isEducationMaterialKind(kindValue)) return { ok: false as const, error: "자료 구분이 올바르지 않습니다" };

  let lessonNumber: number | null = null;
  if (kindValue === "lesson") {
    lessonNumber = Number(lessonNumberValue);
    if (!Number.isInteger(lessonNumber) || lessonNumber < 1 || lessonNumber > 999) {
      return { ok: false as const, error: "과 번호를 올바르게 입력해 주세요" };
    }
  }

  const defaultOrder = kindValue === "lesson" ? lessonNumber! : 1000;
  const sortOrder = sortOrderValue ? Number(sortOrderValue) : defaultOrder;
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) {
    return { ok: false as const, error: "정렬 순서는 0~9999 사이의 숫자로 입력해 주세요" };
  }

  return { ok: true as const, title, kind: kindValue as EducationMaterialKind, lessonNumber, sortOrder };
}

function validatePdf(file: File) {
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) {
    return "PDF 파일만 올릴 수 있습니다";
  }
  if (file.size <= 0) return "빈 파일은 올릴 수 없습니다";
  if (file.size > EDUCATION_MATERIAL_MAX_BYTES) return "PDF 파일은 30MB 이하만 올릴 수 있습니다";
  return null;
}

function apiError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: NextRequest) {
  const deptId = req.nextUrl.searchParams.get("dept_id") || "";
  const verified = await verifyAccess(req, deptId);
  if (!verified.ok) return apiError(verified.error, verified.status);

  const materialId = req.nextUrl.searchParams.get("material_id");
  if (materialId) {
    const material = await readMaterial(deptId, materialId);
    if (!material) return apiError("자료를 찾을 수 없습니다", 404);

    const { data, error } = await r2.from(EDUCATION_MATERIALS_BUCKET).getObject(material.filePath);
    if (error || !data) return apiError("PDF 파일을 찾을 수 없습니다", 404);

    const headers = new Headers({
      "Content-Type": "application/pdf",
      "Content-Length": String(data.contentLength),
      "Cache-Control": "private, max-age=300",
    });
    if (req.nextUrl.searchParams.get("download") === "1") {
      const fallback = material.kind === "lesson" && material.lessonNumber
        ? `${material.lessonNumber}과.pdf`
        : "교육자료.pdf";
      headers.set("Content-Disposition", `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(material.originalName)}`);
    }
    return new NextResponse(new Uint8Array(data.body), { status: 200, headers });
  }

  const { data, error } = await r2.from(EDUCATION_MATERIALS_BUCKET).list(deptId, { limit: 500 });
  if (error) return apiError("교육자료 목록을 불러오지 못했습니다", 500);

  const jsonFiles = (data || []).filter((item) => item.name.endsWith(".json"));
  const materials = (await Promise.all(jsonFiles.map((item) => {
    const id = item.name.slice(0, -5);
    return readMaterial(deptId, id);
  }))).filter((item): item is EducationMaterial => !!item);

  return NextResponse.json({
    ok: true,
    deptName: verified.deptName,
    canManage: verified.canManage,
    materials: sortEducationMaterials(materials).map((item) => ({
      ...item,
      pdfUrl: `/api/edu/materials?dept_id=${encodeURIComponent(deptId)}&material_id=${encodeURIComponent(item.id)}`,
      downloadUrl: `/api/edu/materials?dept_id=${encodeURIComponent(deptId)}&material_id=${encodeURIComponent(item.id)}&download=1`,
    })),
  });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const deptId = String(form.get("dept_id") || "");
  const verified = await verifyAccess(req, deptId);
  if (!verified.ok) return apiError(verified.error, verified.status);
  if (!verified.canManage) return apiError("교육자료 업로드 권한이 없습니다", 403);

  const fields = parseFields(form);
  if (!fields.ok) return apiError(fields.error, 400);
  const file = form.get("file");
  if (!(file instanceof File)) return apiError("PDF 파일을 선택해 주세요", 400);
  const fileError = validatePdf(file);
  if (fileError) return apiError(fileError, fileError.includes("30MB") ? 413 : 415);

  const id = randomUUID();
  const now = new Date().toISOString();
  const filePath = `${deptId}/${id}-${Date.now()}.pdf`;
  const bytes = await file.arrayBuffer();
  const uploaded = await r2.from(EDUCATION_MATERIALS_BUCKET).upload(filePath, bytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (uploaded.error) return apiError("PDF 업로드에 실패했습니다", 500);

  const material: EducationMaterial = {
    id,
    deptId,
    kind: fields.kind,
    lessonNumber: fields.lessonNumber,
    title: fields.title,
    sortOrder: fields.sortOrder,
    filePath,
    originalName: file.name,
    sizeBytes: file.size,
    createdAt: now,
    updatedAt: now,
    uploadedBy: verified.userId,
  };
  const metadata = await writeMaterial(material);
  if (metadata.error) {
    await r2.from(EDUCATION_MATERIALS_BUCKET).remove([filePath]);
    return apiError("자료 정보 저장에 실패했습니다", 500);
  }

  return NextResponse.json({ ok: true, material });
}

export async function PATCH(req: NextRequest) {
  const form = await req.formData();
  const deptId = String(form.get("dept_id") || "");
  const materialId = String(form.get("material_id") || "");
  const verified = await verifyAccess(req, deptId);
  if (!verified.ok) return apiError(verified.error, verified.status);
  if (!verified.canManage) return apiError("교육자료 수정 권한이 없습니다", 403);

  const current = await readMaterial(deptId, materialId);
  if (!current) return apiError("수정할 자료를 찾을 수 없습니다", 404);
  const fields = parseFields(form);
  if (!fields.ok) return apiError(fields.error, 400);

  const fileValue = form.get("file");
  const replacement = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
  if (replacement) {
    const fileError = validatePdf(replacement);
    if (fileError) return apiError(fileError, fileError.includes("30MB") ? 413 : 415);
  }

  let nextFilePath = current.filePath;
  if (replacement) {
    nextFilePath = `${deptId}/${materialId}-${Date.now()}.pdf`;
    const uploaded = await r2.from(EDUCATION_MATERIALS_BUCKET).upload(nextFilePath, await replacement.arrayBuffer(), {
      contentType: "application/pdf",
      upsert: false,
    });
    if (uploaded.error) return apiError("교체 PDF 업로드에 실패했습니다", 500);
  }

  const updated: EducationMaterial = {
    ...current,
    kind: fields.kind,
    lessonNumber: fields.lessonNumber,
    title: fields.title,
    sortOrder: fields.sortOrder,
    filePath: nextFilePath,
    originalName: replacement?.name || current.originalName,
    sizeBytes: replacement?.size || current.sizeBytes,
    updatedAt: new Date().toISOString(),
    uploadedBy: verified.userId,
  };
  const metadata = await writeMaterial(updated);
  if (metadata.error) {
    if (replacement) await r2.from(EDUCATION_MATERIALS_BUCKET).remove([nextFilePath]);
    return apiError("자료 수정사항 저장에 실패했습니다", 500);
  }
  if (replacement && current.filePath !== nextFilePath) {
    await r2.from(EDUCATION_MATERIALS_BUCKET).remove([current.filePath]);
  }

  return NextResponse.json({ ok: true, material: updated });
}

export async function DELETE(req: NextRequest) {
  const deptId = req.nextUrl.searchParams.get("dept_id") || "";
  const materialId = req.nextUrl.searchParams.get("material_id") || "";
  const verified = await verifyAccess(req, deptId);
  if (!verified.ok) return apiError(verified.error, verified.status);
  if (!verified.canManage) return apiError("교육자료 삭제 권한이 없습니다", 403);

  const material = await readMaterial(deptId, materialId);
  if (!material) return apiError("삭제할 자료를 찾을 수 없습니다", 404);
  const removed = await r2.from(EDUCATION_MATERIALS_BUCKET).remove([
    material.filePath,
    metadataPath(deptId, materialId),
  ]);
  if (removed.error) return apiError("교육자료 삭제에 실패했습니다", 500);

  return NextResponse.json({ ok: true });
}
