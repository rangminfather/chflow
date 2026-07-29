import type {
  CourseNormalization,
  DateNormalization,
  EducationAudience,
  EducationCategory,
  NameNormalization,
  RequirementType,
} from "./types";

export const PARSER_VERSION = "education-hwpx-v1.0.0";

const HISTORICAL_ROLES = [
  "교육사",
  "전도사",
  "장로",
  "권사",
  "집사",
  "목사",
  "사모",
  "청년",
  "학생",
  "성도",
  "자매",
  "형제",
  "간사",
] as const;

const BASIC_REQUIRED = new Set(["생명의삶", "새로운삶", "확신의삶", "경건의삶", "하경의삶"]);
const ELECTIVES = new Set([
  "부부의삶",
  "부모의삶",
  "말씀의삶",
  "목자목녀의삶",
  "선교의삶",
  "자유케하는삶",
  "기도의삶",
  "통독의삶",
  "행복의삶",
  "싱글의삶",
  "일터의삶",
  "교사의삶",
  "예비부부의삶",
  "영적전쟁과자유케하는삶",
  "관계전도의삶",
]);

type CourseCandidate = {
  token: string;
  standard: string;
  category: EducationCategory;
  audience?: EducationAudience;
};

const COURSE_CANDIDATES: CourseCandidate[] = [
  { token: "영적전쟁과자유케하는삶", standard: "영적전쟁과 자유케 하는 삶", category: "life_study" },
  { token: "어성경이읽어지네구약", standard: "어성경이읽어지네 구약", category: "bible_training" },
  { token: "어성경이읽어지네신약", standard: "어성경이읽어지네 신약", category: "bible_training" },
  { token: "어린이생명의삶", standard: "생명의삶", category: "life_study", audience: "child" },
  { token: "청소년생명의삶", standard: "생명의삶", category: "life_study", audience: "youth" },
  { token: "어린이삶공부", standard: "어린이 삶공부", category: "life_study", audience: "child" },
  { token: "청소년삶공부", standard: "청소년 삶공부", category: "life_study", audience: "youth" },
  { token: "일대일제자양육", standard: "일대일제자양육", category: "discipleship" },
  { token: "pet전도훈련", standard: "PET전도훈련", category: "mission_training" },
  { token: "부부성장학교", standard: "부부성장학교", category: "family_ministry", audience: "couple" },
  { token: "남편사랑교실", standard: "남편사랑교실", category: "family_ministry", audience: "couple" },
  { token: "목자목녀의삶", standard: "목자목녀의삶", category: "life_study", audience: "leader" },
  { token: "자유케하는삶", standard: "자유케하는삶", category: "life_study" },
  { token: "관계전도의삶", standard: "관계전도의삶", category: "life_study" },
  { token: "예비부부의삶", standard: "예비부부의삶", category: "life_study", audience: "couple" },
  { token: "생명의삶", standard: "생명의삶", category: "life_study" },
  { token: "새로운삶", standard: "새로운삶", category: "life_study" },
  { token: "확신의삶", standard: "확신의삶", category: "life_study" },
  { token: "경건의삶", standard: "경건의삶", category: "life_study" },
  { token: "하경의삶", standard: "하경의삶", category: "life_study" },
  { token: "부부의삶", standard: "부부의삶", category: "life_study", audience: "couple" },
  { token: "부모의삶", standard: "부모의삶", category: "life_study", audience: "parent" },
  { token: "말씀의삶", standard: "말씀의삶", category: "life_study" },
  { token: "선교의삶", standard: "선교의삶", category: "life_study" },
  { token: "기도의삶", standard: "기도의삶", category: "life_study" },
  { token: "통독의삶", standard: "통독의삶", category: "life_study" },
  { token: "행복의삶", standard: "행복의삶", category: "life_study" },
  { token: "싱글의삶", standard: "싱글의삶", category: "life_study" },
  { token: "일터의삶", standard: "일터의삶", category: "life_study" },
  { token: "교사의삶", standard: "교사의삶", category: "life_study", audience: "leader" },
  { token: "확신반", standard: "확신반", category: "discipleship" },
  { token: "성장반", standard: "성장반", category: "discipleship" },
  { token: "전도폭발", standard: "전도폭발", category: "mission_training" },
  { token: "크로스웨이", standard: "크로스웨이", category: "bible_training" },
  { token: "mlts", standard: "MLTS", category: "leadership_training", audience: "leader" },
  { token: "lmtc", standard: "LMTC", category: "lmtc" },
];
COURSE_CANDIDATES.sort((a, b) => b.token.length - a.token.length);

export function compactText(value: string | null | undefined): string {
  return (value ?? "").normalize("NFC").replace(/\s+/g, "").trim();
}

export function normalizePersonName(rawValue: string | null | undefined): NameNormalization {
  const personNameRaw = (rawValue ?? "").trim();
  if (!personNameRaw) {
    return {
      personNameRaw,
      personNameNormalized: null,
      historicalRoleRaw: null,
      disambiguatorRaw: null,
      organizationRaw: null,
      normalizationNote: "이름 공란",
      needsReview: true,
    };
  }

  let working = compactText(personNameRaw);
  const disambiguators = [...working.matchAll(/\(([^)]*)\)/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  working = working.replace(/\([^)]*\)/g, "");

  let historicalRoleRaw: string | null = null;
  for (const role of HISTORICAL_ROLES) {
    if (working.endsWith(role) && working.length > role.length) {
      historicalRoleRaw = role;
      working = working.slice(0, -role.length);
      break;
    }
  }

  let organizationRaw: string | null = null;
  const organizationMatch = working.match(/^([가-힣]{2,4})([가-힣]{2,20}(?:교회|지역|목장))$/);
  if (organizationMatch) {
    working = organizationMatch[1];
    organizationRaw = organizationMatch[2];
  }

  const certainName = /^[가-힣]{2,4}$/.test(working);
  const notes: string[] = [];
  if (!certainName) notes.push("정규화 이름 형식 검수 필요");
  if (disambiguators.length > 1) notes.push("괄호 표기 복수");

  return {
    personNameRaw,
    personNameNormalized: working || null,
    historicalRoleRaw,
    disambiguatorRaw: disambiguators.length ? disambiguators.join(" / ") : null,
    organizationRaw,
    normalizationNote: notes.length ? notes.join("; ") : null,
    needsReview: !certainName || disambiguators.length > 1,
  };
}

function audienceFromRaw(compact: string): EducationAudience {
  if (compact.includes("어린이") || compact.includes("유아")) return "child";
  if (compact.includes("청소년") || compact.includes("중고등")) return "youth";
  if (compact.includes("부부") || compact.includes("예비부부")) return "couple";
  if (compact.includes("부모")) return "parent";
  if (compact.includes("목자목녀") || compact.includes("리더") || compact.includes("교사")) return "leader";
  return "adult";
}

export function normalizeCourseName(
  rawValue: string | null | undefined,
  sourceType?: "general_education_history" | "lmtc_history" | "standard_csv",
): CourseNormalization {
  const raw = (rawValue ?? "").trim();
  const compact = compactText(raw).toLowerCase();
  const range = compact.match(/(?:제)?(\d{1,3})기\s*[-~～]\s*(\d{1,3})기/);
  const exact = range ? null : compact.match(/(?:제)?(\d{1,3})기/);
  const classMatch = compact.match(/(?:^|[^a-z])([a-z])(?:반)?$/i);
  const cohortFrom = range ? Number(range[1]) : null;
  const cohortTo = range ? Number(range[2]) : null;
  const cohortNo = exact ? Number(exact[1]) : null;
  const cohortLabelRaw = range?.[0] ?? exact?.[0] ?? null;
  const audience = audienceFromRaw(compact);

  if (sourceType === "lmtc_history") {
    return {
      standardCourseName: "LMTC",
      cohortNo,
      cohortLabelRaw,
      cohortFrom,
      cohortTo,
      cohortPrecision: range ? "range" : exact ? "exact" : "unknown",
      classVariant: classMatch?.[1]?.toUpperCase() ?? null,
      audience,
      ministryDepartment: raw || null,
      category: "lmtc",
      requirementType: "not_applicable",
      normalizationStatus: "auto_suggested",
      normalizationNote: range ? "기수 범위이므로 단일 기수를 지정하지 않음" : null,
    };
  }

  const candidate = COURSE_CANDIDATES.find((item) => compact.includes(item.token));
  if (!candidate) {
    return {
      standardCourseName: null,
      cohortNo,
      cohortLabelRaw,
      cohortFrom,
      cohortTo,
      cohortPrecision: range ? "range" : exact ? "exact" : "unknown",
      classVariant: classMatch?.[1]?.toUpperCase() ?? null,
      audience: audience === "adult" ? "unknown" : audience,
      ministryDepartment: raw || null,
      category: "unclassified",
      requirementType: "unknown",
      normalizationStatus: "unclassified",
      normalizationNote: "표준 과정 자동 추천 없음",
    };
  }

  const candidateCompact = compactText(candidate.standard).toLowerCase();
  const requirementType: RequirementType =
    candidate.category !== "life_study"
      ? "not_applicable"
      : (candidate.audience ?? audience) !== "adult"
        ? "not_applicable"
        : BASIC_REQUIRED.has(candidateCompact)
          ? "basic_required"
          : ELECTIVES.has(candidateCompact)
            ? "elective"
            : "unknown";

  return {
    standardCourseName: candidate.standard,
    cohortNo,
    cohortLabelRaw,
    cohortFrom,
    cohortTo,
    cohortPrecision: range ? "range" : exact ? "exact" : "unknown",
    classVariant: classMatch?.[1]?.toUpperCase() ?? null,
    audience: candidate.audience ?? audience,
    ministryDepartment: null,
    category: candidate.category,
    requirementType,
    normalizationStatus: "auto_suggested",
    normalizationNote:
      candidate.standard === "생명의삶" && (candidate.audience === "child" || candidate.audience === "youth")
        ? "대상만 분리하며 성인 기본필수로 인정하지 않음"
        : null,
  };
}

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeYear(value: number): number {
  if (value >= 100) return value;
  return value <= 49 ? 2000 + value : 1900 + value;
}

function attendanceFromText(value: string, sourceType?: string): DateNormalization["attendanceStatus"] {
  const compact = compactText(value);
  if (compact.includes("신청")) return "applied";
  if (compact.includes("미수료") || compact.includes("미이수")) return "incomplete";
  if (compact.includes("교육")) return "education";
  if (compact.includes("이수")) return "attended";
  if (compact.includes("수료")) return "completed";
  return sourceType === "general_education_history" ? "completed" : "unknown";
}

export function normalizeDate(
  rawValue: string | null | undefined,
  statusValue: string | null | undefined,
  sourceType?: "general_education_history" | "lmtc_history" | "standard_csv",
): DateNormalization {
  const raw = (rawValue ?? "").trim();
  const combined = `${raw} ${statusValue ?? ""}`.trim();
  const attendanceStatus = attendanceFromText(combined, sourceType);
  if (!raw) {
    return {
      startedOn: null,
      endedOn: null,
      completedOn: null,
      datePrecision: "unknown",
      attendanceStatus,
      dateParseStatus: "blank",
      parsedYear: null,
      parsedMonth: null,
      normalizationNote: "날짜 공란",
    };
  }

  const compact = compactText(raw);
  const range = compact.match(/(\d{4})년?(\d{1,2})[./월](\d{1,2})일?\s*[-~～]\s*(?:(\d{4})년?)?(\d{1,2})[./월](\d{1,2})일?/);
  if (range) {
    const start = isoDate(Number(range[1]), Number(range[2]), Number(range[3]));
    const end = isoDate(Number(range[4] || range[1]), Number(range[5]), Number(range[6]));
    return {
      startedOn: start,
      endedOn: end,
      completedOn: attendanceStatus === "applied" ? null : end,
      datePrecision: "range",
      attendanceStatus,
      dateParseStatus: start && end ? "parsed" : "invalid",
      parsedYear: Number(range[1]),
      parsedMonth: Number(range[2]),
      normalizationNote: start && end ? null : "교육기간 날짜 검수 필요",
    };
  }

  const day = compact.match(/(\d{2,4})년?[./년-]\s*(\d{1,2})[./월-]\s*(\d{1,2})일?/);
  if (day) {
    const year = normalizeYear(Number(day[1]));
    const value = isoDate(year, Number(day[2]), Number(day[3]));
    return {
      startedOn: null,
      endedOn: null,
      completedOn: attendanceStatus === "applied" ? null : value,
      datePrecision: "day",
      attendanceStatus,
      dateParseStatus: value ? "parsed" : "invalid",
      parsedYear: year,
      parsedMonth: Number(day[2]),
      normalizationNote: value ? null : "유효하지 않은 일자",
    };
  }

  const month = compact.match(/(\d{2,4})년?[./년-]\s*(\d{1,2})(?:월)?/);
  if (month) {
    const year = normalizeYear(Number(month[1]));
    const monthNo = Number(month[2]);
    const value = monthNo >= 1 && monthNo <= 12 ? isoDate(year, monthNo, 1) : null;
    return {
      startedOn: attendanceStatus === "applied" ? value : null,
      endedOn: null,
      completedOn: attendanceStatus === "applied" ? null : value,
      datePrecision: "month",
      attendanceStatus,
      dateParseStatus: value ? "partial" : "invalid",
      parsedYear: year,
      parsedMonth: monthNo,
      normalizationNote: value ? "일자 미상; 월 정렬용으로 1일 저장" : "유효하지 않은 월",
    };
  }

  const yearOnly = compact.match(/(?:^|\D)(\d{4})년?(?:\D|$)/);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    const value = isoDate(year, 1, 1);
    return {
      startedOn: attendanceStatus === "applied" ? value : null,
      endedOn: null,
      completedOn: attendanceStatus === "applied" ? null : value,
      datePrecision: "year",
      attendanceStatus,
      dateParseStatus: "partial",
      parsedYear: year,
      parsedMonth: null,
      normalizationNote: "월·일 미상; 연도 정렬용으로 1월 1일 저장",
    };
  }

  return {
    startedOn: null,
    endedOn: null,
    completedOn: null,
    datePrecision: "unknown",
    attendanceStatus,
    dateParseStatus: "invalid",
    parsedYear: null,
    parsedMonth: null,
    normalizationNote: "날짜 형식 검수 필요",
  };
}
