"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useConfirm } from "@/components/ConfirmDialog";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView } from "@/components/StatusViews";
import { Medal, Lock } from "lucide-react";

interface Rule {
  id: string;
  rule_kind: "weekly" | "special" | "bonus";
  rule_key: string;
  label: string;
  points: number;
  notes: string | null;
  order_no: number;
  is_active: boolean;
}

const ACTIVE_KIND: Rule["rule_kind"] = "weekly";
const ACTIVE_KIND_LABEL = "매주 체크 항목";
const ACTIVE_KIND_DESC = "달란트통장에서 매주 직접 체크하는 항목과 출석 자동 적립 점수를 정합니다.";

const AUTO_ATTENDANCE_KEY = "attendance";

function createRuleKey(kind: Rule["rule_kind"]) {
  const prefix = kind === "weekly" ? "custom" : kind;
  return `${prefix}_${Date.now().toString(36)}`;
}

function getRuleMethod(rule: Pick<Partial<Rule>, "rule_kind" | "rule_key">) {
  if (rule.rule_kind === "weekly" && rule.rule_key === AUTO_ATTENDANCE_KEY) {
    return { label: "출석 자동", desc: "출석부에서 출석으로 체크되면 자동 적립", tone: "auto" as const };
  }
  if (rule.rule_kind === "weekly") {
    return { label: "직접 체크", desc: "달란트통장에서 교사가 직접 체크", tone: "manual" as const };
  }
  return { label: "필요 시 지급", desc: "상황에 맞게 따로 지급", tone: "manual" as const };
}

export default function TalentRulesPage() {
  const router = useRouter();
  const { confirm } = useConfirm();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [myGrade, setMyGrade] = useState<number | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  // 편집 모달
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);
  const [saving, setSaving] = useState(false);

  const showToast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 2800);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("list_talent_rules", { p_dept_id: deptId });
    setLoading(false);
    if (error) { showToast("조회 실패: " + error.message); return; }
    setRules((data as Rule[]) || []);
  }, [deptId, showToast]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      const gradeR = await supabase.rpc("get_user_grade", { p_dept_id: deptId });
      setMyGrade(typeof gradeR.data === "number" ? gradeR.data : Number(gradeR.data));
      await load();
    })();
  }, [deptId, load, router]);

  const canEdit = myGrade !== null && myGrade <= 2;
  const filtered = rules.filter(r => r.rule_kind === ACTIVE_KIND);

  function openNew() {
    setEditing({
      rule_kind: ACTIVE_KIND,
      rule_key: createRuleKey(ACTIVE_KIND),
      label: "",
      points: 0,
      notes: "",
      order_no: rules.filter(r => r.rule_kind === ACTIVE_KIND).length,
      is_active: true,
    });
  }

  function openEdit(r: Rule) {
    setEditing({ ...r });
  }

  async function handleSave() {
    if (!editing) return;
    if (!editing.label?.trim()) { showToast("이름을 입력하세요"); return; }
    const ruleKind = editing.rule_kind || "weekly";
    const ruleKey = editing.rule_key?.trim() || createRuleKey(ruleKind);
    setSaving(true);
    const { error } = await supabase.rpc("save_talent_rule", {
      p_id:       editing.id || null,
      p_dept_id:  deptId,
      p_kind:     ruleKind,
      p_key:      ruleKey,
      p_label:    editing.label.trim(),
      p_points:   editing.points || 0,
      p_notes:    editing.notes || null,
      p_order:    editing.order_no || 0,
      p_active:   editing.is_active ?? true,
    });
    setSaving(false);
    if (error) { showToast("저장 실패: " + error.message); return; }
    setEditing(null);
    showToast("저장됨");
    await load();
  }

  async function handleDelete(r: Rule) {
    if (!await confirm(`"${r.label}" 항목을 삭제하시겠습니까?`)) return;
    const { error } = await supabase.rpc("delete_talent_rule", { p_id: r.id });
    if (error) { showToast("삭제 실패: " + error.message); return; }
    showToast("삭제됨");
    await load();
  }

  if (!authChecked || loading) return <LoadingView full />;

  if (!canEdit && filtered.length === 0) {
    return (
      <div style={pageStyle}>
        <div style={{ maxWidth: 480, margin: "60px auto", padding: 24 }}>
          <div style={{ background: "var(--card)", borderRadius: 16, padding: 28, textAlign: "center" }}>
            <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}><Medal size={40} strokeWidth={1.8} color="var(--ink-faint)" /></div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>달란트 항목 미설정</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 20 }}>임원진(등급 0~2: 부장·총무·서기)만 항목을 등록·수정할 수 있습니다</div>
            <button onClick={() => router.push(`/departments/d/${deptId}`)} style={primaryBtn}>← 부서홈</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>

      <div className="app-subpage-header" style={headerStyle}>
          <HeaderLogo />
          <button className="app-header-back" onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtn}>← 부서홈</button>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", display: "inline-flex", alignItems: "center", gap: 6 }}><Medal size={18} strokeWidth={1.8} /> 달란트 항목설정</div>
        <div style={{ width: 60 }} />
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>

        {/* 안내 */}
        <div style={{ background: "var(--card)", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.7 }}>
          {ACTIVE_KIND_DESC}
        </div>

        {/* 규칙 리스트 */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={sectionLabel}>{ACTIVE_KIND_LABEL} ({filtered.length}개)</div>
            {canEdit && (
              <button onClick={() => openNew()} style={addBtn}>+ 항목 추가</button>
            )}
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", color: "var(--ink-faint)", fontSize: 12 }}>
              아직 항목이 없습니다.{canEdit ? " 우측 상단 [+ 항목 추가] 로 등록하세요." : ""}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {filtered.map(r => {
                const method = getRuleMethod(r);
                return (
                <div key={r.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 10,
                  background: r.is_active ? "var(--surface)" : "var(--card)",
                  border: r.is_active ? "1px solid var(--hairline)" : "1.5px dashed var(--hairline-strong)",
                  opacity: r.is_active ? 1 : 0.6,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
                      {r.label}
                      {!r.is_active && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--ink-faint)" }}>비활성</span>}
                    </div>
                    {r.notes && <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>{r.notes}</div>}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                      <span style={method.tone === "auto" ? autoBadge : manualBadge}>{method.label}</span>
                      <span style={{ fontSize: 10, color: "var(--ink-faint)" }}>{method.desc}</span>
                    </div>
                  </div>
                  <div style={{
                    minWidth: 56, textAlign: "center",
                    padding: "6px 10px", borderRadius: 8,
                    background: "var(--accent-soft)", color: "var(--accent-strong)",
                    fontSize: 14, fontWeight: 800,
                  }}>
                    {r.points}
                  </div>
                  {canEdit && (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => openEdit(r)} style={smallBtn}>수정</button>
                      <button onClick={() => handleDelete(r)} style={{ ...smallBtn, color: "var(--danger)", background: "var(--danger-soft)" }}>삭제</button>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>

        {!canEdit && (
          <div style={{ marginTop: 14, fontSize: 11, color: "var(--ink-faint)", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
            <Lock size={12} strokeWidth={1.8} /> 항목 편집은 임원진(등급 0~2) 권한이 필요합니다.
          </div>
        )}
      </div>

      {/* 편집 모달 */}
      {editing && (
        <div style={modalBackdrop} onClick={() => !saving && setEditing(null)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>
                {editing.id ? "항목 수정" : "항목 추가"} · {ACTIVE_KIND_LABEL}
              </div>
              <button onClick={() => !saving && setEditing(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--ink-faint)" }}>×</button>
            </div>

            <label style={lbl}>항목 이름</label>
            <input type="text" value={editing.label || ""} onChange={(e) => setEditing(s => ({ ...s!, label: e.target.value }))}
              placeholder="예: 출석, 성경책 지참, 요절암송" style={input} />

            <label style={lbl}>적립 방식</label>
            <div style={methodBox}>
              <span style={getRuleMethod(editing).tone === "auto" ? autoBadge : manualBadge}>
                {getRuleMethod(editing).label}
              </span>
              <span style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.55 }}>
                {getRuleMethod(editing).desc}
              </span>
            </div>

            <label style={lbl}>점수 (달란트)</label>
            <input type="number" value={editing.points ?? 0}
              onChange={(e) => setEditing(s => ({ ...s!, points: parseInt(e.target.value, 10) || 0 }))}
              style={input} />

            <label style={lbl}>설명/메모 (선택)</label>
            <textarea value={editing.notes || ""}
              onChange={(e) => setEditing(s => ({ ...s!, notes: e.target.value }))}
              rows={2}
              placeholder="예: 필요하면 운영 메모를 적어두세요"
              style={{ ...input, resize: "vertical", minHeight: 50, fontFamily: "inherit" }} />

            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <input type="checkbox" id="active" checked={editing.is_active ?? true}
                onChange={(e) => setEditing(s => ({ ...s!, is_active: e.target.checked }))} />
              <label htmlFor="active" style={{ fontSize: 12, color: "var(--ink-mid)", cursor: "pointer" }}>사용함</label>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => !saving && setEditing(null)} disabled={saving}
                style={{ flex: 1, padding: "10px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit" }}>취소</button>
              <button onClick={handleSave} disabled={saving}
                style={{ flex: 2, padding: "10px", background: "linear-gradient(135deg, var(--accent), var(--accent-muted))", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, color: "#fff", cursor: saving ? "wait" : "pointer", fontFamily: "inherit" }}>
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" };
const headerStyle: React.CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between" };
const card: React.CSSProperties = { background: "var(--card)", borderRadius: 14, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" };
const sectionLabel: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: "var(--ink-mid)", letterSpacing: 0.5 };
const backBtn: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 12, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
const primaryBtn: React.CSSProperties = { padding: "10px 20px", background: "linear-gradient(135deg, var(--accent), var(--accent-muted))", color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const addBtn: React.CSSProperties = { padding: "6px 12px", background: "linear-gradient(135deg, var(--accent), var(--accent-muted))", color: "#fff", border: "none", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const smallBtn: React.CSSProperties = { padding: "5px 10px", background: "var(--bg-soft)", color: "var(--ink-mid)", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 700, color: "var(--ink-mid)", marginTop: 8, marginBottom: 4 };
const input: React.CSSProperties = { width: "100%", padding: "8px 10px", fontSize: 13, border: "1.5px solid var(--hairline-strong)", borderRadius: 8, fontFamily: "inherit", boxSizing: "border-box", marginBottom: 8 };
const methodBox: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 8, marginBottom: 8 };
const autoBadge: React.CSSProperties = { flexShrink: 0, padding: "3px 8px", borderRadius: 999, background: "var(--accent-soft)", color: "var(--accent-strong)", fontSize: 10, fontWeight: 800 };
const manualBadge: React.CSSProperties = { flexShrink: 0, padding: "3px 8px", borderRadius: 999, background: "var(--bg-soft)", color: "var(--ink-mid)", fontSize: 10, fontWeight: 800 };
const modalBackdrop: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(43, 39, 34,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 };
const modalBox: React.CSSProperties = { background: "var(--card)", borderRadius: 14, padding: 20, width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto", fontFamily: "inherit" };
const toastStyle: React.CSSProperties = { position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(43, 39, 34,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 13, fontWeight: 600, zIndex: 1100, fontFamily: "inherit", whiteSpace: "nowrap" };
