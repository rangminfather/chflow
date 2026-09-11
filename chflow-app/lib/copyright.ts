export type CopyrightStatus = "approved" | "licensed" | "pending" | "unconfirmed";

export const COPYRIGHT_STATUSES: CopyrightStatus[] = ["approved", "licensed", "pending", "unconfirmed"];

export function isCopyrightStatus(value: unknown): value is CopyrightStatus {
  return typeof value === "string" && (COPYRIGHT_STATUSES as string[]).includes(value);
}

export const COPYRIGHT_STATUS_LABEL: Record<CopyrightStatus, string> = {
  approved: "정식 승인",
  licensed: "라이선스 구매",
  pending: "검토중",
  unconfirmed: "미확인",
};

export interface CopyrightItem {
  id: string;
  category: string;
  assetName: string;
  rightsHolder: string;
  status: CopyrightStatus;
  scope: string | null;
  approvalMethod: string | null;
  approvalDate: string | null;
  requiredNotice: string | null;
  notes: string | null;
  evidenceImagePath: string | null;
  evidenceCaption: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// DB row(snake_case) → 프론트 타입(camelCase)
export function fromRow(row: Record<string, unknown>): CopyrightItem {
  return {
    id: String(row.id),
    category: String(row.category ?? ""),
    assetName: String(row.asset_name ?? ""),
    rightsHolder: String(row.rights_holder ?? ""),
    status: isCopyrightStatus(row.status) ? row.status : "unconfirmed",
    scope: (row.scope as string | null) ?? null,
    approvalMethod: (row.approval_method as string | null) ?? null,
    approvalDate: (row.approval_date as string | null) ?? null,
    requiredNotice: (row.required_notice as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    evidenceImagePath: (row.evidence_image_path as string | null) ?? null,
    evidenceCaption: (row.evidence_caption as string | null) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export const COPYRIGHT_EVIDENCE_BUCKET = "copyright-evidence";
export const COPYRIGHT_EVIDENCE_MAX_BYTES = 8 * 1024 * 1024; // 8MB
export const COPYRIGHT_EVIDENCE_ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

// evidence_image_path 가 "/"로 시작하면 기존에 public/ 에 커밋해둔 레거시 이미지 경로이고,
// 아니면 R2 오브젝트 키다 — 화면에서 <img src>를 직접 쓸지 프록시 API를 거칠지 이걸로 구분한다.
export function isLegacyPublicEvidencePath(path: string): boolean {
  return path.startsWith("/");
}
