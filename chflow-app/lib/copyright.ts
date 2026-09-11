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

// 등록 화면 선택지 — DB의 category 컬럼은 여전히 자유 텍스트라, 목록에 없는 값(과거에 직접
// 입력된 값 포함)은 폼에서 "기타(직접 입력)"으로 취급한다. 새 분류가 자주 필요해지면 이 배열만
// 늘리면 된다.
export const COPYRIGHT_CATEGORIES = [
  "성경 본문",
  "찬양·음원",
  "폰트",
  "이미지·아이콘",
  "영상",
  "오픈소스 라이브러리",
] as const;

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

export type CopyrightAuditAction = "create" | "update" | "delete";

export const COPYRIGHT_AUDIT_ACTION_LABEL: Record<CopyrightAuditAction, string> = {
  create: "등록",
  update: "수정",
  delete: "삭제",
};

export interface CopyrightAuditEntry {
  id: string;
  itemId: string | null;
  assetName: string;
  action: CopyrightAuditAction;
  actorEmail: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

function isCopyrightAuditAction(value: unknown): value is CopyrightAuditAction {
  return value === "create" || value === "update" || value === "delete";
}

export function fromAuditRow(row: Record<string, unknown>): CopyrightAuditEntry {
  return {
    id: String(row.id),
    itemId: (row.item_id as string | null) ?? null,
    assetName: String(row.asset_name ?? ""),
    action: isCopyrightAuditAction(row.action) ? row.action : "update",
    actorEmail: (row.actor_email as string | null) ?? null,
    before: (row.before as Record<string, unknown> | null) ?? null,
    after: (row.after as Record<string, unknown> | null) ?? null,
    createdAt: String(row.created_at ?? ""),
  };
}

// 이력 화면에 보여줄 필드만 선별 — DB 컬럼명 → 한글 라벨
export const AUDIT_FIELD_LABEL: Record<string, string> = {
  category: "분류",
  asset_name: "대상 자료명",
  rights_holder: "저작권자·공급자",
  status: "상태",
  scope: "허용 범위",
  approval_method: "승인 방식",
  approval_date: "승인 일자",
  required_notice: "표시 의무 사항",
  notes: "비고",
  evidence_image_path: "증빙 이미지",
  evidence_caption: "증빙 설명",
};
