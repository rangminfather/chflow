import type { EducationAudience, RequirementType } from "./types";

export interface DatedCoursePolicy {
  courseId: string;
  requirementType: RequirementType;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  active?: boolean;
}

export interface CompletionForPolicy {
  courseId: string;
  audience: EducationAudience;
  attendanceStatus: string;
}

export function policyAt(
  policies: DatedCoursePolicy[],
  courseId: string,
  date: string,
): DatedCoursePolicy | null {
  return policies
    .filter((policy) =>
      policy.courseId === courseId
      && policy.active !== false
      && (policy.effectiveFrom === null || policy.effectiveFrom <= date)
      && (policy.effectiveTo === null || policy.effectiveTo >= date),
    )
    .sort((a, b) => (b.effectiveFrom ?? "").localeCompare(a.effectiveFrom ?? ""))[0] ?? null;
}

export function calculateCurrentRequiredProgress(
  policies: DatedCoursePolicy[],
  completions: CompletionForPolicy[],
  today: string,
): { requiredCourseIds: string[]; completedCourseIds: string[]; status: "met" | "not_met" | "needs_review" } {
  const courseIds = [...new Set(policies.map((policy) => policy.courseId))];
  const requiredCourseIds = courseIds.filter((courseId) =>
    policyAt(policies, courseId, today)?.requirementType === "basic_required",
  );
  const completedCourseIds = requiredCourseIds.filter((courseId) =>
    completions.some((completion) =>
      completion.courseId === courseId
      && completion.audience === "adult"
      && ["completed", "attended"].includes(completion.attendanceStatus),
    ),
  );
  return {
    requiredCourseIds,
    completedCourseIds,
    status: requiredCourseIds.length === 0
      ? "needs_review"
      : completedCourseIds.length === requiredCourseIds.length
        ? "met"
        : "not_met",
  };
}
