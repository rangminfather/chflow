import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { r2 } from "@/lib/r2";
import {
  EDUCATION_MATERIAL_MAX_BYTES,
  EDUCATION_MATERIALS_BUCKET,
  isEducationMaterialKind,
  type EducationMaterial,
} from "@/lib/educationMaterials";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "icn1";

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ELEMENTARY1_DEPT_ID = "882ee0b6-af49-46bb-a077-682a9536cb76";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function authorized(request: NextRequest) {
  const provided = request.headers.get("x-education-import-key") || "";
  if (!SERVICE_KEY || provided.length !== SERVICE_KEY.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(SERVICE_KEY));
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return new NextResponse(null, { status: 404 });

  const form = await request.formData();
  const deptId = String(form.get("dept_id") || "");
  const materialId = String(form.get("material_id") || "");
  const uploadedBy = String(form.get("uploaded_by") || "");
  const kind = String(form.get("kind") || "");
  const title = String(form.get("title") || "").trim();
  const lessonValue = String(form.get("lesson_number") || "");
  const sortOrder = Number(form.get("sort_order"));
  const file = form.get("file");

  if (deptId !== ELEMENTARY1_DEPT_ID || !UUID_RE.test(materialId) || !UUID_RE.test(uploadedBy)) {
    return NextResponse.json({ ok: false, error: "잘못된 등록 대상입니다" }, { status: 400 });
  }
  if (!isEducationMaterialKind(kind) || !title || title.length > 120 || !Number.isInteger(sortOrder)) {
    return NextResponse.json({ ok: false, error: "자료 정보가 올바르지 않습니다" }, { status: 400 });
  }
  const lessonNumber = kind === "lesson" ? Number(lessonValue) : null;
  if (kind === "lesson" && (!Number.isInteger(lessonNumber) || lessonNumber! < 1 || lessonNumber! > 999)) {
    return NextResponse.json({ ok: false, error: "과 번호가 올바르지 않습니다" }, { status: 400 });
  }
  if (!(file instanceof File) || !/\.pdf$/i.test(file.name) || file.size <= 0 || file.size > EDUCATION_MATERIAL_MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "PDF 파일이 올바르지 않습니다" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const filePath = `${deptId}/${materialId}.pdf`;
  const material: EducationMaterial = {
    id: materialId,
    deptId,
    kind,
    lessonNumber,
    title,
    sortOrder,
    filePath,
    originalName: file.name,
    sizeBytes: file.size,
    createdAt: now,
    updatedAt: now,
    uploadedBy,
  };
  const pdfResult = await r2.from(EDUCATION_MATERIALS_BUCKET).upload(filePath, await file.arrayBuffer(), {
    contentType: "application/pdf",
    upsert: true,
  });
  if (pdfResult.error) return NextResponse.json({ ok: false, error: "PDF 업로드 실패" }, { status: 500 });

  const metadataPath = `${deptId}/${materialId}.json`;
  const metadataResult = await r2.from(EDUCATION_MATERIALS_BUCKET).upload(
    metadataPath,
    Buffer.from(JSON.stringify(material), "utf8"),
    { contentType: "application/json; charset=utf-8", upsert: true },
  );
  if (metadataResult.error) {
    await r2.from(EDUCATION_MATERIALS_BUCKET).remove([filePath]);
    return NextResponse.json({ ok: false, error: "자료 정보 저장 실패" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: materialId });
}
