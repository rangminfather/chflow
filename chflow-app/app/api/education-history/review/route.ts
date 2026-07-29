import { NextRequest } from "next/server";
import { EDUCATION_CAPABILITIES, educationErrorResponse, requireEducationCapability } from "@/lib/server/education-auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      rowId?: string;
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
