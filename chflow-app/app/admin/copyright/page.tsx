"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  type LucideIcon,
  Plus,
  Pencil,
  Trash2,
  X,
  ImagePlus,
  ChevronRight,
  ShieldCheck,
  ScrollText,
  Clock3,
  ShieldAlert,
  History,
  KeyRound,
} from "lucide-react";
import HeaderLogo from "@/components/HeaderLogo";
import ModalBackdrop from "@/components/ModalBackdrop";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { supabase } from "@/lib/supabase";
import {
  COPYRIGHT_STATUSES,
  COPYRIGHT_STATUS_LABEL,
  COPYRIGHT_CATEGORIES,
  COPYRIGHT_AUDIT_ACTION_LABEL,
  AUDIT_FIELD_LABEL,
  isLegacyPublicEvidencePath,
  type CopyrightItem,
  type CopyrightStatus,
  type CopyrightAuditEntry,
  type CopyrightAuditAction,
} from "@/lib/copyright";

const CUSTOM_CATEGORY = "__custom__";
function isKnownCategory(value: string): boolean {
  return (COPYRIGHT_CATEGORIES as readonly string[]).includes(value);
}

const STATUS_META: Record<CopyrightStatus, { label: string; color: string; soft: string; icon: LucideIcon }> = {
  approved: { label: COPYRIGHT_STATUS_LABEL.approved, color: "var(--success)", soft: "var(--success-soft)", icon: ShieldCheck },
  licensed: { label: COPYRIGHT_STATUS_LABEL.licensed, color: "var(--info)", soft: "var(--info-soft)", icon: ScrollText },
  pending: { label: COPYRIGHT_STATUS_LABEL.pending, color: "var(--warning)", soft: "var(--warning-soft)", icon: Clock3 },
  unconfirmed: { label: COPYRIGHT_STATUS_LABEL.unconfirmed, color: "var(--danger)", soft: "var(--danger-soft)", icon: ShieldAlert },
};

type FormTarget = CopyrightItem | "new" | null;

async function authedFetch(input: string, init: globalThis.RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  let res = await fetch(input, { ...init, headers });
  if (res.status === 401) {
    const { data } = await supabase.auth.refreshSession();
    if (data.session) {
      headers.set("Authorization", `Bearer ${data.session.access_token}`);
      res = await fetch(input, { ...init, headers });
    }
  }
  return res;
}

function evidenceSrc(path: string) {
  return isLegacyPublicEvidencePath(path) ? path : `/api/admin/copyright/evidence?path=${encodeURIComponent(path)}`;
}

export default function AdminCopyrightPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [items, setItems] = useState<CopyrightItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | CopyrightStatus>("all");
  const [selected, setSelected] = useState<CopyrightItem | null>(null);
  const [formTarget, setFormTarget] = useState<FormTarget>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await authedFetch("/api/admin/copyright");
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setLoadError(json?.error || "목록을 불러오지 못했습니다");
      setItems([]);
    } else {
      setItems(json.items as CopyrightItem[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.role !== "admin") {
        router.replace("/home");
        return;
      }
      setAuthChecked(true);
    })();
  }, [router]);

  useEffect(() => {
    if (authChecked) loadItems();
  }, [authChecked, loadItems]);

  const counts = useMemo(() => {
    const base: Record<"all" | CopyrightStatus, number> = {
      all: items.length, approved: 0, licensed: 0, pending: 0, unconfirmed: 0,
    };
    for (const item of items) base[item.status] += 1;
    return base;
  }, [items]);

  const visibleItems = useMemo(
    () => (filter === "all" ? items : items.filter((item) => item.status === filter)),
    [items, filter]
  );

  async function handleDelete(item: CopyrightItem) {
    if (!window.confirm(`"${item.assetName}" 항목을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    const pin = window.prompt("이 항목을 삭제하려면 관리자 비밀번호를 입력하세요.");
    if (pin === null) return;
    if (!pin.trim()) {
      window.alert("관리자 비밀번호를 입력해 주세요");
      return;
    }
    const res = await authedFetch(`/api/admin/copyright?id=${encodeURIComponent(item.id)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      window.alert(json?.error || "삭제에 실패했습니다");
      return;
    }
    setSelected(null);
    await loadItems();
  }

  if (!authChecked) {
    return <LoadingView label="권한 확인 중..." full />;
  }

  return (
    <div style={pageStyle}>
      <div style={wrapStyle}>
        <header style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <HeaderLogo />
            <div>
              <div style={kickerStyle}>COPYRIGHT &amp; LICENSE REGISTRY</div>
              <h1 style={titleStyle}>저작권·라이선스 등록대장</h1>
              <div style={subTitleStyle}>외부 연동 콘텐츠의 저작권 허가·라이선스 대응 현황을 건별로 등록·확인합니다</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => router.push("/home")} style={ghostButtonStyle}>홈</button>
            <button onClick={() => setHistoryOpen(true)} style={ghostButtonStyle}>
              <History size={14} /> 변경 이력
            </button>
            <button onClick={() => setFormTarget("new")} style={primaryButtonStyle}>
              <Plus size={15} strokeWidth={2.4} /> 새 항목 등록
            </button>
          </div>
        </header>

        <section style={noticeStyle}>
          이 대장은 이 시스템에 연동하는 저작권 보호 콘텐츠(성경 번역본, 폰트, 외부 자료 등)에 대해 정식
          허가·라이선스 구매·기타 대응 근거를 남기기 위한 기록입니다. 새 건은 이 화면에서 한 건씩 등록하고,
          근거가 확인될 때까지는 &ldquo;검토중&rdquo; 상태로 남겨 둡니다 — 여러 건을 한꺼번에 반영하지 않습니다.
          함부로 바뀌면 안 되는 근거 기록이라, <strong>수정·삭제 시에는 관리자 비밀번호를 추가로 확인</strong>하고
          모든 등록·수정·삭제는 행위자와 함께 이력에 남습니다.
        </section>

        <div style={filterRowStyle}>
          <FilterChip label={`전체 ${counts.all}`} active={filter === "all"} onClick={() => setFilter("all")} />
          {COPYRIGHT_STATUSES.map((status) => (
            <FilterChip
              key={status}
              label={`${STATUS_META[status].label} ${counts[status]}`}
              active={filter === status}
              color={STATUS_META[status].color}
              onClick={() => setFilter(status)}
            />
          ))}
        </div>

        {loading && <LoadingView label="등록 현황을 불러오는 중..." />}
        {!loading && loadError && (
          <EmptyState icon={<ShieldAlert size={22} strokeWidth={1.6} />} message={loadError} hint="새로고침 후 다시 시도해 주세요" />
        )}
        {!loading && !loadError && visibleItems.length === 0 && (
          <EmptyState
            icon={<ScrollText size={22} strokeWidth={1.6} />}
            message={filter === "all" ? "등록된 항목이 없습니다" : "이 상태의 항목이 없습니다"}
            hint={filter === "all" ? "오른쪽 위 '새 항목 등록'으로 첫 건을 등록해 주세요" : undefined}
          />
        )}
        {!loading && !loadError && visibleItems.length > 0 && (
          <section style={gridStyle}>
            {visibleItems.map((item) => (
              <CopyrightCard key={item.id} item={item} onOpen={() => setSelected(item)} />
            ))}
          </section>
        )}
      </div>

      {selected && (
        <CopyrightDetailModal
          item={selected}
          onClose={() => setSelected(null)}
          onEdit={() => { setFormTarget(selected); setSelected(null); }}
          onDelete={() => handleDelete(selected)}
          onPreview={setPreviewSrc}
        />
      )}

      {formTarget && (
        <CopyrightFormModal
          target={formTarget === "new" ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={async () => { setFormTarget(null); await loadItems(); }}
        />
      )}

      {historyOpen && <AuditLogModal onClose={() => setHistoryOpen(false)} />}

      {previewSrc && (
        <ModalBackdrop onClose={() => setPreviewSrc(null)} style={{ zIndex: 300 }}>
          <div onClick={(e) => e.stopPropagation()} style={previewCardStyle}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewSrc} alt="증빙 이미지" style={previewImgStyle} />
            <button onClick={() => setPreviewSrc(null)} style={previewCloseStyle}>닫기</button>
          </div>
        </ModalBackdrop>
      )}
    </div>
  );
}

function FilterChip({ label, active, color, onClick }: { label: string; active: boolean; color?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...chipStyle,
        ...(active
          ? {
            background: color ? `color-mix(in srgb, ${color} 16%, transparent)` : "var(--accent-soft)",
            color: color ?? "var(--accent-strong)",
            borderColor: color ? `color-mix(in srgb, ${color} 42%, transparent)` : "var(--accent-line)",
          }
          : {}),
      }}
    >
      {label}
    </button>
  );
}

function SealBadge({ status, size = 40 }: { status: CopyrightStatus; size?: number }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        background: meta.soft,
        color: meta.color,
        border: `2px solid color-mix(in srgb, ${meta.color} 45%, var(--brass))`,
        flexShrink: 0,
      }}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </div>
  );
}

function CopyrightCard({ item, onOpen }: { item: CopyrightItem; onOpen: () => void }) {
  const meta = STATUS_META[item.status];
  return (
    <button onClick={onOpen} style={cardButtonStyle}>
      <div style={{ ...cardAccentBarStyle, background: meta.color }} />
      <div style={cardBodyStyle}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <SealBadge status={item.status} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={categoryStyle}>{item.category}</div>
            <h2 style={assetNameStyle}>{item.assetName}</h2>
            <div style={rightsHolderStyle}>{item.rightsHolder}</div>
          </div>
          <ChevronRight size={18} style={{ color: "var(--ink-faint)", flexShrink: 0, marginTop: 4 }} />
        </div>
        <span style={{ ...badgeStyle, color: meta.color, background: meta.soft, alignSelf: "flex-start" }}>
          {meta.label}
        </span>
      </div>
    </button>
  );
}

function CopyrightDetailModal({
  item, onClose, onEdit, onDelete, onPreview,
}: {
  item: CopyrightItem;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPreview: (src: string) => void;
}) {
  const meta = STATUS_META[item.status];
  return (
    <ModalBackdrop onClose={onClose} style={{ zIndex: 200 }}>
      <div onClick={(e) => e.stopPropagation()} style={certOuterStyle}>
        <div style={certInnerStyle}>
          <button onClick={onClose} style={certCloseStyle} aria-label="닫기"><X size={18} /></button>

          <div style={certHeadStyle}>
            <SealBadge status={item.status} size={56} />
            <span style={{ ...badgeStyle, color: meta.color, background: meta.soft }}>{meta.label}</span>
            <div style={certKickerStyle}>{item.category}</div>
            <h2 style={certTitleStyle}>{item.assetName}</h2>
            <div style={rightsHolderStyle}>저작권자·공급자 — {item.rightsHolder}</div>
          </div>

          <div style={ornamentDividerStyle}>
            <span style={ornamentLineStyle} /><span style={ornamentDotStyle} /><span style={ornamentLineStyle} />
          </div>

          <div style={fieldGridStyle}>
            <Field label="허용 범위">{item.scope || "—"}</Field>
            <Field label="승인 방식">{item.approvalMethod || "—"}</Field>
            <Field label="승인 일자">{item.approvalDate || "—"}</Field>
            <Field label="표시 의무 사항">{item.requiredNotice || "—"}</Field>
            {item.notes && <Field label="비고">{item.notes}</Field>}
          </div>

          {item.evidenceImagePath && (
            <div style={evidenceWrapStyle}>
              <button
                type="button"
                onClick={() => onPreview(evidenceSrc(item.evidenceImagePath!))}
                style={evidenceFrameButtonStyle}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={evidenceSrc(item.evidenceImagePath)} alt={item.evidenceCaption ?? "증빙 이미지"} style={evidenceThumbStyle} />
              </button>
              {item.evidenceCaption && <div style={evidenceCaptionStyle}>{item.evidenceCaption}</div>}
            </div>
          )}

          <div style={certFooterStyle}>
            <button onClick={onDelete} style={dangerGhostButtonStyle}><Trash2 size={14} /> 삭제</button>
            <button onClick={onEdit} style={ghostButtonStyle}><Pencil size={14} /> 수정</button>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function CopyrightFormModal({
  target, onClose, onSaved,
}: {
  target: CopyrightItem | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const isEdit = !!target;
  const [categoryChoice, setCategoryChoice] = useState<string>(() => {
    if (!target) return "";
    return isKnownCategory(target.category) ? target.category : CUSTOM_CATEGORY;
  });
  const [customCategory, setCustomCategory] = useState(
    target && !isKnownCategory(target.category) ? target.category : ""
  );
  const category = categoryChoice === CUSTOM_CATEGORY ? customCategory : categoryChoice;
  const [assetName, setAssetName] = useState(target?.assetName ?? "");
  const [rightsHolder, setRightsHolder] = useState(target?.rightsHolder ?? "");
  const [status, setStatus] = useState<CopyrightStatus>(target?.status ?? "pending");
  const [scope, setScope] = useState(target?.scope ?? "");
  const [approvalMethod, setApprovalMethod] = useState(target?.approvalMethod ?? "");
  const [approvalDate, setApprovalDate] = useState(target?.approvalDate ?? "");
  const [requiredNotice, setRequiredNotice] = useState(target?.requiredNotice ?? "");
  const [notes, setNotes] = useState(target?.notes ?? "");
  const [evidenceCaption, setEvidenceCaption] = useState(target?.evidenceCaption ?? "");
  const [slug, setSlug] = useState(target?.slug ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [removeEvidence, setRemoveEvidence] = useState(false);
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) { setFilePreview(null); return; }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const existingEvidenceSrc = target?.evidenceImagePath && !removeEvidence ? evidenceSrc(target.evidenceImagePath) : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!categoryChoice) {
      setError("분류를 선택해 주세요");
      return;
    }
    if (categoryChoice === CUSTOM_CATEGORY && !customCategory.trim()) {
      setError("분류를 입력해 주세요");
      return;
    }
    if (!assetName.trim() || !rightsHolder.trim()) {
      setError("대상 자료명·저작권자는 필수입니다");
      return;
    }
    if (isEdit && !pin.trim()) {
      setError("수정하려면 관리자 비밀번호를 입력해 주세요");
      return;
    }
    setSaving(true);
    setError(null);

    const form = new FormData();
    if (isEdit) form.set("id", target!.id);
    form.set("category", category.trim());
    form.set("asset_name", assetName.trim());
    form.set("rights_holder", rightsHolder.trim());
    form.set("status", status);
    form.set("scope", scope.trim());
    form.set("approval_method", approvalMethod.trim());
    form.set("approval_date", approvalDate);
    form.set("required_notice", requiredNotice.trim());
    form.set("notes", notes.trim());
    form.set("evidence_caption", evidenceCaption.trim());
    form.set("sort_order", String(target?.sortOrder ?? 0));
    form.set("slug", slug.trim());
    if (file) form.set("file", file);
    if (isEdit && removeEvidence && !file) form.set("remove_evidence", "1");
    if (isEdit) form.set("pin", pin.trim());

    const res = await authedFetch("/api/admin/copyright", { method: isEdit ? "PATCH" : "POST", body: form });
    const json = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok || !json?.ok) {
      setError(json?.error || "저장에 실패했습니다");
      return;
    }
    await onSaved();
  }

  return (
    <ModalBackdrop onClose={onClose} style={{ zIndex: 250 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit} style={formCardStyle}>
        <div style={formHeaderStyle}>
          <h2 style={formTitleStyle}>{isEdit ? "항목 수정" : "새 저작권·라이선스 항목 등록"}</h2>
          <button type="button" onClick={onClose} style={iconGhostButtonStyle} aria-label="닫기"><X size={18} /></button>
        </div>

        <div style={formScrollStyle}>
          <FormSectionLabel>기본 정보</FormSectionLabel>
          <FormRow label="분류" required>
            <select value={categoryChoice} onChange={(e) => setCategoryChoice(e.target.value)} style={inputStyle}>
              <option value="" disabled>선택하세요</option>
              {COPYRIGHT_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value={CUSTOM_CATEGORY}>기타 (직접 입력)</option>
            </select>
            {categoryChoice === CUSTOM_CATEGORY && (
              <input
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="분류를 직접 입력하세요"
                style={{ ...inputStyle, marginTop: 8 }}
              />
            )}
          </FormRow>
          <FormRow label="대상 자료명" required>
            <input value={assetName} onChange={(e) => setAssetName(e.target.value)} placeholder="정확한 명칭" style={inputStyle} />
          </FormRow>
          <FormRow label="저작권자·공급자" required>
            <input value={rightsHolder} onChange={(e) => setRightsHolder(e.target.value)} style={inputStyle} />
          </FormRow>
          <FormRow label="코드명 (선택)">
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="예: nkrv-bskorea — 앱 화면에서 이 항목으로 바로 연결할 때만 필요"
              style={inputStyle}
            />
          </FormRow>

          <FormSectionLabel>승인 정보 — 확인 전에는 &ldquo;검토중&rdquo;으로 등록하세요</FormSectionLabel>
          <FormRow label="상태" required>
            <select value={status} onChange={(e) => setStatus(e.target.value as CopyrightStatus)} style={inputStyle}>
              {COPYRIGHT_STATUSES.map((s) => (
                <option key={s} value={s}>{COPYRIGHT_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </FormRow>
          <FormRow label="허용 범위">
            <textarea value={scope} onChange={(e) => setScope(e.target.value)} style={textareaStyle} rows={2} />
          </FormRow>
          <FormRow label="승인 방식">
            <input value={approvalMethod} onChange={(e) => setApprovalMethod(e.target.value)} style={inputStyle} placeholder="예: 이메일 승인, 서면 계약, 오픈소스 라이선스" />
          </FormRow>
          <FormRow label="승인 일자">
            <input type="date" value={approvalDate} onChange={(e) => setApprovalDate(e.target.value)} style={inputStyle} />
          </FormRow>
          <FormRow label="표시 의무 사항">
            <textarea value={requiredNotice} onChange={(e) => setRequiredNotice(e.target.value)} style={textareaStyle} rows={2} />
          </FormRow>

          <FormSectionLabel>증빙</FormSectionLabel>
          <FormRow label="증빙 이미지">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(filePreview || existingEvidenceSrc) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={filePreview ?? existingEvidenceSrc!} alt="증빙 미리보기" style={evidenceThumbStyle} />
              )}
              <label style={fileButtonStyle}>
                <ImagePlus size={14} /> {file ? file.name : "이미지 선택 (PNG·JPEG·WEBP, 8MB 이하)"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  style={{ display: "none" }}
                />
              </label>
              {isEdit && target?.evidenceImagePath && !file && (
                <label style={checkboxRowStyle}>
                  <input type="checkbox" checked={removeEvidence} onChange={(e) => setRemoveEvidence(e.target.checked)} />
                  기존 증빙 이미지 삭제
                </label>
              )}
            </div>
          </FormRow>
          <FormRow label="증빙 설명">
            <input
              value={evidenceCaption}
              onChange={(e) => setEvidenceCaption(e.target.value)}
              style={inputStyle}
              placeholder="예: 승인 이메일 캡처 (수신자 개인정보는 가림 처리 후 첨부)"
            />
          </FormRow>

          <FormSectionLabel>비고</FormSectionLabel>
          <FormRow label="비고">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={textareaStyle} rows={2} />
          </FormRow>

          {isEdit && (
            <>
              <FormSectionLabel>실행 확인</FormSectionLabel>
              <FormRow label="관리자 비밀번호" required>
                <div style={pinRowStyle}>
                  <KeyRound size={14} style={{ color: "var(--ink-faint)", flexShrink: 0 }} />
                  <input
                    type="password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    style={{ ...inputStyle, flex: 1 }}
                    placeholder="수정을 실행하려면 입력하세요"
                    autoComplete="off"
                  />
                </div>
              </FormRow>
            </>
          )}
        </div>

        {error && <div style={formErrorStyle}>{error}</div>}

        <div style={formFooterStyle}>
          <button type="button" onClick={onClose} style={ghostButtonStyle}>취소</button>
          <button type="submit" disabled={saving} style={{ ...primaryButtonStyle, opacity: saving ? 0.7 : 1 }}>
            {saving ? "저장 중..." : isEdit ? "저장" : "등록"}
          </button>
        </div>
      </form>
    </ModalBackdrop>
  );
}

const AUDIT_ACTION_COLOR: Record<CopyrightAuditAction, string> = {
  create: "var(--success)",
  update: "var(--warning)",
  delete: "var(--danger)",
};

function AuditLogModal({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<CopyrightAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await authedFetch("/api/admin/copyright/audit");
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error || "이력을 불러오지 못했습니다");
      } else {
        setEntries(json.entries as CopyrightAuditEntry[]);
      }
      setLoading(false);
    })();
  }, []);

  return (
    <ModalBackdrop onClose={onClose} style={{ zIndex: 260 }}>
      <div onClick={(e) => e.stopPropagation()} style={formCardStyle}>
        <div style={formHeaderStyle}>
          <h2 style={formTitleStyle}>등록·수정·삭제 이력</h2>
          <button type="button" onClick={onClose} style={iconGhostButtonStyle} aria-label="닫기"><X size={18} /></button>
        </div>

        <div style={formScrollStyle}>
          {loading && <LoadingView label="이력을 불러오는 중..." padding={24} />}
          {!loading && error && <EmptyState icon={<ShieldAlert size={20} strokeWidth={1.6} />} message={error} />}
          {!loading && !error && entries.length === 0 && (
            <EmptyState icon={<History size={20} strokeWidth={1.6} />} message="아직 등록·수정·삭제 이력이 없습니다" />
          )}
          {!loading && !error && entries.map((entry) => (
            <AuditLogRow
              key={entry.id}
              entry={entry}
              expanded={expandedId === entry.id}
              onToggle={() => setExpandedId((cur) => (cur === entry.id ? null : entry.id))}
            />
          ))}
        </div>
      </div>
    </ModalBackdrop>
  );
}

function AuditLogRow({ entry, expanded, onToggle }: { entry: CopyrightAuditEntry; expanded: boolean; onToggle: () => void }) {
  const changedFields = diffFields(entry.before, entry.after);
  return (
    <div style={auditRowStyle}>
      <button type="button" onClick={onToggle} style={auditRowHeaderStyle}>
        <span style={{ ...badgeStyle, color: AUDIT_ACTION_COLOR[entry.action], background: `color-mix(in srgb, ${AUDIT_ACTION_COLOR[entry.action]} 14%, transparent)` }}>
          {COPYRIGHT_AUDIT_ACTION_LABEL[entry.action]}
        </span>
        <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <div style={auditAssetNameStyle}>{entry.assetName}</div>
          <div style={auditMetaStyle}>{formatDateTime(entry.createdAt)} · {entry.actorEmail ?? "알 수 없음"}</div>
        </div>
        <ChevronRight size={16} style={{ color: "var(--ink-faint)", flexShrink: 0, transform: expanded ? "rotate(90deg)" : undefined }} />
      </button>
      {expanded && (
        <div style={auditDetailStyle}>
          {changedFields.length === 0 && <div style={auditEmptyDiffStyle}>세부 변경 내용이 없습니다</div>}
          {changedFields.map((f) => (
            <div key={f.key} style={auditFieldRowStyle}>
              <div style={auditFieldLabelStyle}>{AUDIT_FIELD_LABEL[f.key] ?? f.key}</div>
              <div style={auditFieldValueStyle}>
                {f.before !== undefined && <span style={auditBeforeStyle}>{f.before}</span>}
                {f.before !== undefined && f.after !== undefined && <span style={{ color: "var(--ink-faint)" }}> → </span>}
                {f.after !== undefined && <span>{f.after}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function diffFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): { key: string; before?: string; after?: string }[] {
  const keys = Object.keys(AUDIT_FIELD_LABEL);
  const result: { key: string; before?: string; after?: string }[] = [];
  for (const key of keys) {
    const b = before ? before[key] : undefined;
    const a = after ? after[key] : undefined;
    const bStr = formatFieldValue(b);
    const aStr = formatFieldValue(a);
    if (!before) {
      // 등록: 값이 있는 필드만
      if (aStr) result.push({ key, after: aStr });
    } else if (!after) {
      // 삭제: 값이 있는 필드만
      if (bStr) result.push({ key, before: bStr });
    } else if (bStr !== aStr) {
      result.push({ key, before: bStr || "(없음)", after: aStr || "(없음)" });
    }
  }
  return result;
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function formatDateTime(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function FormSectionLabel({ children }: { children: ReactNode }) {
  return <div style={formSectionLabelStyle}>{children}</div>;
}

function FormRow({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={formLabelStyle}>
        {label}{required && <span style={{ color: "var(--danger)" }}> *</span>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={fieldLabelStyle}>{label}</div>
      <div style={fieldValueStyle}>{children}</div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg-soft)",
  fontFamily: "'Noto Sans KR', sans-serif",
  padding: 16,
};

const wrapStyle: React.CSSProperties = {
  maxWidth: 920,
  margin: "0 auto",
};

const headerStyle: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: "16px 18px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 14,
};

const kickerStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.14em",
  color: "var(--brass)",
};

const titleStyle: React.CSSProperties = {
  margin: "2px 0 0",
  fontSize: 20,
  fontWeight: 800,
  color: "var(--ink)",
  fontFamily: "var(--app-serif)",
};

const subTitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--ink-soft)",
  marginTop: 3,
};

const ghostButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "9px 13px",
  background: "var(--surface)",
  color: "var(--ink-mid)",
  border: "1px solid var(--hairline-strong)",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const dangerGhostButtonStyle: React.CSSProperties = {
  ...ghostButtonStyle,
  color: "var(--danger)",
  borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)",
  background: "color-mix(in srgb, var(--danger) 8%, transparent)",
};

const primaryButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "9px 14px",
  background: "var(--accent)",
  color: "#fff",
  border: "1px solid var(--accent)",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
  fontFamily: "inherit",
};

const iconGhostButtonStyle: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 30,
  height: 30,
  background: "var(--surface)",
  color: "var(--ink-mid)",
  border: "1px solid var(--hairline-strong)",
  borderRadius: 6,
  cursor: "pointer",
  flexShrink: 0,
};

const noticeStyle: React.CSSProperties = {
  background: "var(--info-soft)",
  color: "var(--info)",
  border: "1px solid var(--info-soft)",
  borderRadius: 8,
  padding: "12px 14px",
  fontSize: 12.5,
  lineHeight: 1.6,
  marginBottom: 14,
};

const filterRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  marginBottom: 14,
};

const chipStyle: React.CSSProperties = {
  padding: "7px 12px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--hairline-strong)",
  background: "var(--card)",
  color: "var(--ink-soft)",
  cursor: "pointer",
  fontFamily: "inherit",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
  gap: 12,
};

const cardButtonStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  textAlign: "left",
  background: "var(--card)",
  border: "1px solid var(--hairline)",
  borderRadius: 10,
  padding: 0,
  overflow: "hidden",
  cursor: "pointer",
  fontFamily: "inherit",
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

const cardAccentBarStyle: React.CSSProperties = {
  height: 4,
  width: "100%",
};

const cardBodyStyle: React.CSSProperties = {
  padding: "14px 16px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const categoryStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: "0.06em",
  color: "var(--accent)",
  marginBottom: 2,
  textTransform: "uppercase",
};

const assetNameStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 800,
  color: "var(--ink)",
  fontFamily: "var(--app-serif)",
  lineHeight: 1.35,
};

const rightsHolderStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: "var(--ink-soft)",
  marginTop: 4,
};

const badgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "5px 12px",
  borderRadius: 999,
  fontSize: 11.5,
  fontWeight: 800,
  whiteSpace: "nowrap",
};

const certOuterStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 560,
  maxHeight: "92vh",
  overflow: "auto",
  borderRadius: 16,
  padding: 6,
  background: "color-mix(in srgb, var(--brass) 30%, transparent)",
};

const certInnerStyle: React.CSSProperties = {
  position: "relative",
  background: "var(--card)",
  border: "1px solid var(--hairline-strong)",
  borderRadius: 12,
  padding: "28px 26px 22px",
};

const certCloseStyle: React.CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  display: "grid",
  placeItems: "center",
  width: 28,
  height: 28,
  background: "var(--surface)",
  color: "var(--ink-mid)",
  border: "1px solid var(--hairline-strong)",
  borderRadius: 999,
  cursor: "pointer",
};

const certHeadStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 9,
  textAlign: "center",
};

const certKickerStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.08em",
  color: "var(--accent)",
  textTransform: "uppercase",
  marginTop: 4,
};

const certTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 21,
  fontWeight: 800,
  color: "var(--ink)",
  fontFamily: "var(--app-serif)",
  lineHeight: 1.4,
};

const ornamentDividerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  margin: "20px 0 18px",
};

const ornamentLineStyle: React.CSSProperties = {
  flex: 1,
  height: 1,
  background: "var(--hairline-strong)",
};

const ornamentDotStyle: React.CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: "50%",
  background: "var(--brass)",
  flexShrink: 0,
};

const fieldGridStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: "0.04em",
  color: "var(--ink-faint)",
  textTransform: "uppercase",
  marginBottom: 3,
};

const fieldValueStyle: React.CSSProperties = {
  fontSize: 13.5,
  color: "var(--ink-mid)",
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
};

const evidenceWrapStyle: React.CSSProperties = {
  marginTop: 18,
  paddingTop: 16,
  borderTop: "1px solid var(--hairline)",
};

const evidenceFrameButtonStyle: React.CSSProperties = {
  display: "block",
  padding: 4,
  background: "var(--surface)",
  border: "1px solid var(--hairline-strong)",
  borderRadius: 8,
  cursor: "zoom-in",
  width: "100%",
};

const evidenceThumbStyle: React.CSSProperties = {
  maxWidth: "100%",
  maxHeight: 220,
  borderRadius: 5,
  display: "block",
  margin: "0 auto",
};

const evidenceCaptionStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--ink-faint)",
  marginTop: 8,
  textAlign: "center",
};

const certFooterStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 22,
  paddingTop: 16,
  borderTop: "1px solid var(--hairline)",
};

const previewCardStyle: React.CSSProperties = {
  background: "var(--card)",
  borderRadius: 10,
  padding: 12,
  maxWidth: "min(1100px, 96vw)",
  maxHeight: "92vh",
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const previewImgStyle: React.CSSProperties = {
  maxWidth: "100%",
  borderRadius: 6,
};

const previewCloseStyle: React.CSSProperties = {
  alignSelf: "flex-end",
  padding: "8px 14px",
  background: "var(--surface)",
  color: "var(--ink-mid)",
  border: "1px solid var(--hairline-strong)",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
  fontFamily: "inherit",
};

const formCardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 520,
  maxHeight: "90vh",
  background: "var(--card)",
  border: "1px solid var(--hairline)",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const formHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "16px 18px",
  borderBottom: "1px solid var(--hairline)",
};

const formTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 800,
  color: "var(--ink)",
};

const formScrollStyle: React.CSSProperties = {
  padding: "16px 18px",
  overflowY: "auto",
};

const formSectionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  color: "var(--accent)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  margin: "18px 0 10px",
  paddingBottom: 6,
  borderBottom: "1px solid var(--hairline)",
};

const formLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "var(--ink-mid)",
  marginBottom: 5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 38,
  padding: "0 10px",
  background: "var(--surface)",
  color: "var(--ink)",
  border: "1px solid var(--hairline-strong)",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "inherit",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 60,
  padding: "8px 10px",
  resize: "vertical",
  lineHeight: 1.5,
};

const fileButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 12px",
  background: "var(--surface)",
  color: "var(--ink-mid)",
  border: "1px dashed var(--hairline-strong)",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  width: "fit-content",
};

const checkboxRowStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  color: "var(--ink-soft)",
  cursor: "pointer",
};

const formErrorStyle: React.CSSProperties = {
  margin: "0 18px 12px",
  padding: "9px 12px",
  background: "var(--danger-soft)",
  color: "var(--danger)",
  borderRadius: 6,
  fontSize: 12.5,
};

const formFooterStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  padding: "14px 18px",
  borderTop: "1px solid var(--hairline)",
};

const pinRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  background: "color-mix(in srgb, var(--warning) 8%, var(--surface))",
  border: "1px solid color-mix(in srgb, var(--warning) 35%, transparent)",
  borderRadius: 6,
};

const auditRowStyle: React.CSSProperties = {
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  marginBottom: 8,
  overflow: "hidden",
};

const auditRowHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "10px 12px",
  background: "var(--card)",
  border: 0,
  cursor: "pointer",
  fontFamily: "inherit",
};

const auditAssetNameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "var(--ink)",
};

const auditMetaStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--ink-faint)",
  marginTop: 2,
};

const auditDetailStyle: React.CSSProperties = {
  padding: "10px 12px 12px",
  background: "var(--bg-soft)",
  borderTop: "1px solid var(--hairline)",
};

const auditEmptyDiffStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--ink-faint)",
};

const auditFieldRowStyle: React.CSSProperties = {
  marginBottom: 6,
};

const auditFieldLabelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  color: "var(--ink-faint)",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};

const auditFieldValueStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: "var(--ink-mid)",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
};

const auditBeforeStyle: React.CSSProperties = {
  color: "var(--danger)",
  textDecoration: "line-through",
};
