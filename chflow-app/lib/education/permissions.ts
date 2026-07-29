export const EDUCATION_CAPABILITY = {
  read: "education_history.read",
  manage: "education_history.manage",
  import: "education_history.import",
  approve: "education_history.approve",
  courseManage: "education_course.manage",
  auditRead: "education_history.audit.read",
} as const;

export function canViewEducationHistory(capabilities: readonly string[]): boolean {
  return capabilities.includes(EDUCATION_CAPABILITY.read);
}
export function canManageEducationHistory(capabilities: readonly string[]): boolean {
  return capabilities.includes(EDUCATION_CAPABILITY.manage);
}
export function canImportEducationHistory(capabilities: readonly string[]): boolean {
  return capabilities.includes(EDUCATION_CAPABILITY.import);
}
export function canApproveEducationHistory(capabilities: readonly string[]): boolean {
  return capabilities.includes(EDUCATION_CAPABILITY.approve);
}
export function canManageEducationCourses(capabilities: readonly string[]): boolean {
  return capabilities.includes(EDUCATION_CAPABILITY.courseManage);
}
