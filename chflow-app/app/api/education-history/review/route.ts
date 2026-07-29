import { NextRequest } from "next/server";
import { EDUCATION_CAPABILITIES, educationErrorResponse, requireEducationCapability } from "@/lib/server/education-auth";

export async function GET(request: NextRequest) {
  try {
    const { client } = await requireEducationCapability(request, EDUCATION_CAPABILITIES.manage);
    const params = request.nextUrl.searchParams;
    const page = Math.max(Number.parseInt(params.get("page") ?? "1", 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(params.get("limit") ?? "50", 10) || 50, 1), 100);
    const { data, error } = await client.rpc("education_import_review_page", {
      p_filter: params.get("filter") ?? "all",
      p_batch_id: params.get("batchId") || null,
      p_query: params.get("query") || null,
      p_offset: (page - 1) * limit,
      p_limit: limit,
    });
    if (error) throw new Error(error.message);
    return Response.json(data);
  } catch (error) {
    return educationErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      rowId?: string;
      rowIds?: string[];
      memberId?: string | null;
      courseId?: string | null;
      action?: string;
      reviewNote?: string | null;
      saveAlias?: boolean;
    };
    const action = body.action ?? "hold";
    const capability = ["approve", "unapprove"].includes(action)
      ? EDUCATION_CAPABILITIES.approve
      : EDUCATION_CAPABILITIES.manage;
    const { client } = await requireEducationCapability(request, capability);
    if (body.rowIds?.length) {
      const rowIds = [...new Set(body.rowIds)].slice(0, 50);
      if (!["approve", "exclude", "unapprove"].includes(action)) {
        throw new Error("일괄 작업은 승인·제외·승인 취소만 지원합니다.");
      }
      const { data: rows, error: rowsError } = await client
        .from("education_import_rows")
        .select("id,suggested_member_id,suggested_course_id")
        .in("id", rowIds);
      if (rowsError) throw new Error(rowsError.message);
      const results: Array<{ rowId: string; ok: boolean; historyId?: string | null; error?: string }> = [];
      for (const row of rows ?? []) {
        const { data, error } = await client.rpc("review_education_import_row", {
          p_row_id: row.id,
          p_member_id: action === "approve" ? row.suggested_member_id : null,
          p_course_id: action === "approve" ? row.suggested_course_id : null,
          p_action: action,
          p_review_note: body.reviewNote ?? null,
          p_save_alias: false,
        });
        results.push(error
          ? { rowId: row.id, ok: false, error: error.message }
          : { rowId: row.id, ok: true, historyId: data });
      }
      return Response.json({
        requested: rowIds.length,
        succeeded: results.filter((item) => item.ok).length,
        failed: results.filter((item) => !item.ok).length,
        results,
      });
    }
    if (!body.rowId) throw new Error("rowId가 필요합니다.");
    const { data, error } = await client.rpc("review_education_import_row", {
      p_row_id: body.rowId,
      p_member_id: body.memberId ?? null,
      p_course_id: body.courseId ?? null,
      p_action: action,
      p_review_note: body.reviewNote ?? null,
      p_save_alias: body.saveAlias ?? false,
    });
    if (error) throw new Error(error.message);
    return Response.json({ historyId: data });
  } catch (error) {
    return educationErrorResponse(error);
  }
}
