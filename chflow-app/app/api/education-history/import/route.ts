import { createHash } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { parseEducationHwpxBuffer } from "@/lib/education/parser";
import { EDUCATION_CAPABILITIES, educationErrorResponse, requireEducationCapability } from "@/lib/server/education-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { client } = await requireEducationCapability(request, EDUCATION_CAPABILITIES.import);
    const form = await request.formData();
    const file = form.get("file");
    const requestedType = String(form.get("type") ?? "");
    const sourceType = requestedType === "general"
      ? "general_education_history"
      : requestedType === "lmtc"
        ? "lmtc_history"
        : null;
    if (!(file instanceof File) || !sourceType) throw new Error("HWPX 파일과 자료 유형이 필요합니다.");
    if (path.extname(file.name).toLowerCase() !== ".hwpx") throw new Error("HWPX 파일만 가져올 수 있습니다.");
    if (file.size > 15 * 1024 * 1024) throw new Error("파일 크기는 15MB 이하여야 합니다.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = createHash("sha256").update(bytes).digest("hex");
    const result = await parseEducationHwpxBuffer(bytes, sourceType);
    const { data, error } = await client.rpc("stage_education_import", {
      p_batch: {
        source_filename: file.name,
        source_type: sourceType,
        file_hash: hash,
        parser_version: result.parserVersion,
        total_tables: result.report.totalTables,
        total_rows: result.report.totalExtractedRows,
        valid_rows: result.report.validDataRows,
        invalid_rows: result.report.invalidDataRows,
        repeated_header_rows: result.report.repeatedHeaderRows,
        empty_rows: result.report.emptyRows,
        validation_report: result.report,
      },
      p_rows: result.rows,
    });
    if (error) throw new Error(error.message);
    return Response.json({ batchId: data, report: result.report });
  } catch (error) {
    return educationErrorResponse(error);
  }
}
