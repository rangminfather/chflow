export type EducationSourceType =
  | "general_education_history"
  | "lmtc_history"
  | "standard_csv";

export type EducationCategory =
  | "life_study"
  | "discipleship"
  | "mission_training"
  | "family_ministry"
  | "bible_training"
  | "leadership_training"
  | "lmtc"
  | "other"
  | "unclassified";

export type EducationAudience =
  | "adult"
  | "youth"
  | "child"
  | "couple"
  | "parent"
  | "leader"
  | "unknown";

export type RequirementType =
  | "basic_required"
  | "elective"
  | "not_applicable"
  | "unknown";

export type AttendanceStatus =
  | "completed"
  | "attended"
  | "applied"
  | "education"
  | "incomplete"
  | "unknown";

export type DatePrecision = "day" | "month" | "year" | "range" | "unknown";
export type DateParseStatus = "parsed" | "partial" | "invalid" | "blank" | "unknown";
export type CohortPrecision = "exact" | "range" | "unknown";
export type NormalizationStatus =
  | "auto_suggested"
  | "manually_confirmed"
  | "ambiguous"
  | "unclassified";

export interface HwpxCell {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  text: string;
}

export interface HwpxRow {
  sourceTableNo: number;
  sourceRowNo: number;
  cells: HwpxCell[];
  rawRowText: string;
}

export interface HwpxExtraction {
  sectionFiles: string[];
  tableCount: number;
  rows: HwpxRow[];
}

export interface NameNormalization {
  personNameRaw: string;
  personNameNormalized: string | null;
  historicalRoleRaw: string | null;
  disambiguatorRaw: string | null;
  organizationRaw: string | null;
  normalizationNote: string | null;
  needsReview: boolean;
}

export interface CourseNormalization {
  standardCourseName: string | null;
  cohortNo: number | null;
  cohortLabelRaw: string | null;
  cohortFrom: number | null;
  cohortTo: number | null;
  cohortPrecision: CohortPrecision;
  classVariant: string | null;
  audience: EducationAudience;
  ministryDepartment: string | null;
  category: EducationCategory;
  requirementType: RequirementType;
  normalizationStatus: NormalizationStatus;
  normalizationNote: string | null;
}

export interface DateNormalization {
  startedOn: string | null;
  endedOn: string | null;
  completedOn: string | null;
  datePrecision: DatePrecision;
  attendanceStatus: AttendanceStatus;
  dateParseStatus: DateParseStatus;
  parsedYear: number | null;
  parsedMonth: number | null;
  normalizationNote: string | null;
}

export interface EducationImportRow {
  source_table_no: number;
  source_row_no: number;
  serial_raw: string | null;
  course_name_raw: string | null;
  person_name_raw: string | null;
  instructor_raw: string | null;
  certificate_no_raw: string | null;
  date_raw: string | null;
  note_raw: string | null;
  status_raw: string | null;
  raw_data: {
    cells: HwpxCell[];
  };
  raw_row_text: string;
  parser_version: string;
  person_name_normalized: string | null;
  historical_role_raw: string | null;
  disambiguator_raw: string | null;
  organization_raw: string | null;
  normalization_note: string | null;
  cohort_no: number | null;
  cohort_label_raw: string | null;
  cohort_from: number | null;
  cohort_to: number | null;
  cohort_precision: CohortPrecision;
  class_variant: string | null;
  audience: EducationAudience;
  ministry_department: string | null;
  category: EducationCategory;
  requirement_type: RequirementType;
  started_on: string | null;
  ended_on: string | null;
  completed_on: string | null;
  date_precision: DatePrecision;
  attendance_status: AttendanceStatus;
  date_parse_status: DateParseStatus;
  normalized_data: {
    standard_course_name: string | null;
    parsed_year: number | null;
    parsed_month: number | null;
    course_normalization_note: string | null;
    date_normalization_note: string | null;
  };
  normalization_status: NormalizationStatus;
}

export interface EducationValidationReport {
  sourceType: EducationSourceType;
  parserVersion: string;
  totalTables: number;
  totalExtractedRows: number;
  repeatedHeaderRows: number;
  emptyRows: number;
  excludedNonDataRows: number;
  validDataRows: number;
  invalidDataRows: number;
  nameNormalizationSuccess: number;
  nameReviewRequired: number;
  parentheticalNames: number;
  historicalRoleSeparated: number;
  dateParseSuccess: number;
  dateParseFailure: number;
  blankDates: number;
  appliedRows: number;
  completedRows: number;
  attendedRows: number;
  educationRows: number;
  incompleteRows: number;
  unknownStatusRows: number;
  rawCourseNameCount: number;
  standardCourseSuggested: number;
  unclassifiedCourses: number;
  singleMemberCandidates: number;
  ambiguousMemberCandidates: number;
  unmatchedMemberCandidates: number;
  duplicateSuspected: number;
  warnings: string[];
}

export interface EducationParseResult {
  sourceType: EducationSourceType;
  parserVersion: string;
  rows: EducationImportRow[];
  report: EducationValidationReport;
}
