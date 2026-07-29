import { compactText, normalizeCourseName, normalizeDate, normalizePersonName, PARSER_VERSION } from "./normalize";
import { extractHwpxTables, extractHwpxTablesFromBuffer } from "./hwpx";
import type {
  EducationImportRow,
  EducationParseResult,
  EducationSourceType,
  EducationValidationReport,
  HwpxRow,
} from "./types";

function cell(row: HwpxRow, col: number): string | null {
  const value = row.cells.find((item) => item.col === col)?.text.trim() ?? "";
  return value || null;
}

function isEmpty(row: HwpxRow): boolean {
  return row.cells.every((item) => !item.text.trim());
}

function isHeader(row: HwpxRow): boolean {
  const values = row.cells.map((item) => compactText(item.text));
  return values.includes("일련번호")
    && (values.includes("이름") || values.includes("성명"))
    && values.some((value) => value.includes("부서") && value.includes("과목"));
}

function isNonDataTitle(row: HwpxRow): boolean {
  const populated = row.cells.filter((item) => item.text.trim());
  if (populated.length !== 1) return false;
  const text = compactText(populated[0].text);
  return text.includes("명단") || text.includes("명부") || text.includes("수료자");
}

function makeRow(
  row: HwpxRow,
  sourceType: Extract<EducationSourceType, "general_education_history" | "lmtc_history">,
): EducationImportRow {
  const general = sourceType === "general_education_history";
  const courseNameRaw = cell(row, 1);
  const personNameRaw = cell(row, 2);
  const instructorRaw = general ? cell(row, 3) : null;
  const certificateNoRaw = general ? null : cell(row, 3);
  const dateRaw = cell(row, 4);
  const noteRaw = cell(row, 5);
  const statusRaw = general ? noteRaw : noteRaw;
  const person = normalizePersonName(personNameRaw);
  const course = normalizeCourseName(courseNameRaw, sourceType);
  const date = normalizeDate(dateRaw, statusRaw, sourceType);
  const notes = [
    person.normalizationNote,
    course.normalizationNote,
    date.normalizationNote,
  ].filter(Boolean);

  return {
    source_table_no: row.sourceTableNo,
    source_row_no: row.sourceRowNo,
    serial_raw: cell(row, 0),
    course_name_raw: courseNameRaw,
    person_name_raw: personNameRaw,
    instructor_raw: instructorRaw,
    certificate_no_raw: certificateNoRaw,
    date_raw: dateRaw,
    note_raw: noteRaw,
    status_raw: statusRaw,
    raw_data: { cells: row.cells },
    raw_row_text: row.rawRowText,
    parser_version: PARSER_VERSION,
    person_name_normalized: person.personNameNormalized,
    historical_role_raw: person.historicalRoleRaw,
    disambiguator_raw: person.disambiguatorRaw,
    organization_raw: person.organizationRaw,
    normalization_note: notes.length ? notes.join("; ") : null,
    cohort_no: course.cohortNo,
    cohort_label_raw: course.cohortLabelRaw,
    cohort_from: course.cohortFrom,
    cohort_to: course.cohortTo,
    cohort_precision: course.cohortPrecision,
    class_variant: course.classVariant,
    audience: course.audience,
    ministry_department: course.ministryDepartment,
    category: course.category,
    requirement_type: course.requirementType,
    started_on: date.startedOn,
    ended_on: date.endedOn,
    completed_on: date.completedOn,
    date_precision: date.datePrecision,
    attendance_status: date.attendanceStatus,
    date_parse_status: date.dateParseStatus,
    normalized_data: {
      standard_course_name: course.standardCourseName,
      parsed_year: date.parsedYear,
      parsed_month: date.parsedMonth,
      course_normalization_note: course.normalizationNote,
      date_normalization_note: date.normalizationNote,
    },
    normalization_status: course.normalizationStatus,
  };
}

function createReport(
  sourceType: EducationParseResult["sourceType"],
  totalTables: number,
  totalExtractedRows: number,
  repeatedHeaderRows: number,
  emptyRows: number,
  excludedNonDataRows: number,
  rows: EducationImportRow[],
): EducationValidationReport {
  const valid = rows.filter((row) => row.person_name_raw || row.course_name_raw);
  const courseNames = new Set(rows.map((row) => row.course_name_raw).filter(Boolean));
  return {
    sourceType,
    parserVersion: PARSER_VERSION,
    totalTables,
    totalExtractedRows,
    repeatedHeaderRows,
    emptyRows,
    excludedNonDataRows,
    validDataRows: valid.length,
    invalidDataRows: rows.length - valid.length,
    nameNormalizationSuccess: rows.filter((row) => row.person_name_normalized && !row.normalization_note?.includes("이름")).length,
    nameReviewRequired: rows.filter((row) => !row.person_name_normalized || row.normalization_note?.includes("이름")).length,
    parentheticalNames: rows.filter((row) => row.disambiguator_raw).length,
    historicalRoleSeparated: rows.filter((row) => row.historical_role_raw).length,
    dateParseSuccess: rows.filter((row) => ["parsed", "partial"].includes(row.date_parse_status)).length,
    dateParseFailure: rows.filter((row) => row.date_parse_status === "invalid").length,
    blankDates: rows.filter((row) => row.date_parse_status === "blank").length,
    appliedRows: rows.filter((row) => row.attendance_status === "applied").length,
    completedRows: rows.filter((row) => row.attendance_status === "completed").length,
    attendedRows: rows.filter((row) => row.attendance_status === "attended").length,
    educationRows: rows.filter((row) => row.attendance_status === "education").length,
    incompleteRows: rows.filter((row) => row.attendance_status === "incomplete").length,
    unknownStatusRows: rows.filter((row) => row.attendance_status === "unknown").length,
    rawCourseNameCount: courseNames.size,
    standardCourseSuggested: rows.filter((row) => row.normalized_data.standard_course_name).length,
    unclassifiedCourses: rows.filter((row) => row.normalization_status === "unclassified").length,
    singleMemberCandidates: 0,
    ambiguousMemberCandidates: 0,
    unmatchedMemberCandidates: 0,
    duplicateSuspected: 0,
    warnings: [],
  };
}

function parseExtraction(
  extraction: Awaited<ReturnType<typeof extractHwpxTables>>,
  sourceType: Extract<EducationSourceType, "general_education_history" | "lmtc_history">,
): EducationParseResult {
  let repeatedHeaderRows = 0;
  let emptyRows = 0;
  let excludedNonDataRows = 0;
  const rows: EducationImportRow[] = [];

  for (const row of extraction.rows) {
    if (isHeader(row)) {
      repeatedHeaderRows += 1;
      continue;
    }
    if (isEmpty(row)) {
      emptyRows += 1;
      continue;
    }
    if (isNonDataTitle(row)) {
      excludedNonDataRows += 1;
      continue;
    }
    rows.push(makeRow(row, sourceType));
  }

  const report = createReport(
    sourceType,
    extraction.tableCount,
    extraction.rows.length,
    repeatedHeaderRows,
    emptyRows,
    excludedNonDataRows,
    rows,
  );
  if (excludedNonDataRows > 0) {
    report.warnings.push(`표 제목 등 데이터가 아닌 행 ${excludedNonDataRows}건 제외`);
  }

  const expectedMinimum = sourceType === "general_education_history" ? 3000 : 400;
  if (rows.length < expectedMinimum) {
    report.warnings.push(`예상 최소 데이터 행 ${expectedMinimum}건보다 적게 추출됨`);
  }

  return { sourceType, parserVersion: PARSER_VERSION, rows, report };
}

export async function parseEducationHwpx(
  filePath: string,
  sourceType: Extract<EducationSourceType, "general_education_history" | "lmtc_history">,
): Promise<EducationParseResult> {
  return parseExtraction(await extractHwpxTables(filePath), sourceType);
}

export async function parseEducationHwpxBuffer(
  source: Uint8Array | ArrayBuffer,
  sourceType: Extract<EducationSourceType, "general_education_history" | "lmtc_history">,
): Promise<EducationParseResult> {
  return parseExtraction(await extractHwpxTablesFromBuffer(source), sourceType);
}
