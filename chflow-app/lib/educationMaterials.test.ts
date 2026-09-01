import { describe, expect, it } from "vitest";
import {
  isEducationMaterial,
  isEducationMaterialManagerGrade,
  isEducationMaterialViewerGrade,
  sortEducationMaterials,
  type EducationMaterial,
} from "./educationMaterials";

const material = (overrides: Partial<EducationMaterial>): EducationMaterial => ({
  id: crypto.randomUUID(),
  deptId: "dept-1",
  kind: "lesson",
  lessonNumber: 23,
  title: "23과",
  sortOrder: 23,
  filePath: "dept-1/file.pdf",
  originalName: "23과.pdf",
  sizeBytes: 100,
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  uploadedBy: "user-1",
  ...overrides,
});

describe("교육자료 권한과 정렬", () => {
  it("전도사·교육사·부장 등급만 자료를 관리한다", () => {
    expect(isEducationMaterialManagerGrade(0)).toBe(true);
    expect(isEducationMaterialManagerGrade(1)).toBe(true);
    expect(isEducationMaterialManagerGrade(2)).toBe(false);
    expect(isEducationMaterialManagerGrade(3)).toBe(false);
    expect(isEducationMaterialViewerGrade(3)).toBe(true);
    expect(isEducationMaterialViewerGrade(4)).toBe(false);
  });

  it("일반 과를 번호순으로, 특별절기를 그 뒤에 정렬한다", () => {
    const sorted = sortEducationMaterials([
      material({ kind: "special", lessonNumber: null, title: "성탄주일", sortOrder: 4 }),
      material({ lessonNumber: 24, title: "24과", sortOrder: 24 }),
      material({ lessonNumber: 23, title: "23과", sortOrder: 23 }),
      material({ kind: "special", lessonNumber: null, title: "복음 통일", sortOrder: 1 }),
    ]);
    expect(sorted.map((item) => item.title)).toEqual(["23과", "24과", "복음 통일", "성탄주일"]);
  });

  it("필수 메타데이터가 없는 저장 항목은 거부한다", () => {
    expect(isEducationMaterial(material({}))).toBe(true);
    expect(isEducationMaterial({ id: "broken", kind: "lesson" })).toBe(false);
  });
});
