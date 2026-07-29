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
