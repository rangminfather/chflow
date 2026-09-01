export type EducationMaterialKind = "lesson" | "special";

export type EducationMaterial = {
  id: string;
  deptId: string;
  kind: EducationMaterialKind;
  lessonNumber: number | null;
  title: string;
  sortOrder: number;
  filePath: string;
  originalName: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  uploadedBy: string;
};

export const EDUCATION_MATERIALS_BUCKET = "education-materials";
export const EDUCATION_MATERIAL_MAX_BYTES = 30 * 1024 * 1024;

export function isEducationMaterialManagerGrade(grade: number): boolean {
  return Number.isFinite(grade) && grade >= 0 && grade <= 1;
}

export function isEducationMaterialViewerGrade(grade: number): boolean {
  return Number.isFinite(grade) && grade >= 0 && grade <= 3;
}

export function isEducationMaterialKind(value: unknown): value is EducationMaterialKind {
  return value === "lesson" || value === "special";
}

export function isEducationMaterial(value: unknown): value is EducationMaterial {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<EducationMaterial>;
  return typeof item.id === "string"
    && typeof item.deptId === "string"
    && isEducationMaterialKind(item.kind)
    && (item.lessonNumber === null || typeof item.lessonNumber === "number")
    && typeof item.title === "string"
    && typeof item.sortOrder === "number"
    && typeof item.filePath === "string"
    && typeof item.originalName === "string"
    && typeof item.sizeBytes === "number"
    && typeof item.createdAt === "string"
    && typeof item.updatedAt === "string"
    && typeof item.uploadedBy === "string";
}

export function sortEducationMaterials(items: EducationMaterial[]): EducationMaterial[] {
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "lesson" ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const lessonA = a.lessonNumber ?? Number.MAX_SAFE_INTEGER;
    const lessonB = b.lessonNumber ?? Number.MAX_SAFE_INTEGER;
    if (lessonA !== lessonB) return lessonA - lessonB;
    return a.title.localeCompare(b.title, "ko");
  });
}
