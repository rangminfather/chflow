import { NextRequest } from "next/server";
import { EDUCATION_CAPABILITIES, educationErrorResponse, requireEducationCapability } from "@/lib/server/education-auth";

const ALLOWED_COURSE_FIELDS = [
  "name", "normalized_name", "category", "default_audience",
  "description", "active", "sort_order",
] as const;

export async function POST(request: NextRequest) {
  try {
    const { client } = await requireEducationCapability(request, EDUCATION_CAPABILITIES.courseManage);
    const body = await request.json() as Record<string, unknown>;
    const resource = String(body.resource ?? "course");
    if (resource === "alias") {
      if (!body.rawCourseName || !body.courseId) throw new Error("원본 과정명과 표준 과정이 필요합니다.");
      const raw = String(body.rawCourseName).trim();
      const { data, error } = await client.from("education_course_aliases").insert({
        raw_course_name: raw,
        normalized_raw_name: raw.normalize("NFC").replace(/\s+/g, "").toLowerCase(),
        course_id: String(body.courseId),
        audience: body.audience ? String(body.audience) : null,
        normalization_rule: { source: "manual" },
        verified_by: (await client.auth.getUser()).data.user?.id,
        verified_at: new Date().toISOString(),
      }).select().single();
      if (error) throw new Error(error.message);
      return Response.json(data);
    }
    if (resource === "policy") {
      if (!body.courseId || !body.requirementType || !body.policyName) {
        throw new Error("과정, 정책 구분, 정책명이 필요합니다.");
      }
      const { data, error } = await client.from("education_course_policies").insert({
        course_id: String(body.courseId),
        requirement_type: String(body.requirementType),
        effective_from: body.effectiveFrom || null,
        effective_to: body.effectiveTo || null,
        policy_name: String(body.policyName),
        note: body.note ? String(body.note) : null,
        active: true,
      }).select().single();
      if (error) throw new Error(error.message);
      return Response.json(data);
    }
    const values = Object.fromEntries(ALLOWED_COURSE_FIELDS.flatMap((key) =>
      body[key] === undefined ? [] : [[key, body[key]]],
    ));
    if (!values.name || !values.category) throw new Error("과정명과 분류가 필요합니다.");
    if (!values.normalized_name) {
      values.normalized_name = String(values.name).normalize("NFC").replace(/\s+/g, "").toLowerCase();
    }
    const { data, error } = await client.from("education_courses").insert(values).select().single();
    if (error) throw new Error(error.message);
    return Response.json(data);
  } catch (error) {
    return educationErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { client } = await requireEducationCapability(request, EDUCATION_CAPABILITIES.courseManage);
    const body = await request.json() as Record<string, unknown>;
    if (!body.id) throw new Error("id가 필요합니다.");
    const values = Object.fromEntries(ALLOWED_COURSE_FIELDS.flatMap((key) =>
      body[key] === undefined ? [] : [[key, body[key]]],
    ));
    const { data, error } = await client
      .from("education_courses").update(values).eq("id", String(body.id)).select().single();
    if (error) throw new Error(error.message);
    return Response.json(data);
  } catch (error) {
    return educationErrorResponse(error);
  }
}
