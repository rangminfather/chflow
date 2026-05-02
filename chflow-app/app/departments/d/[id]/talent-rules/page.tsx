"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";

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

const KIND_TABS: { value: Rule["rule_kind"]; label: string; desc: string }[] = [
  { value: "weekly",  label: "매주 적립",  desc: "출석·헌금·주보요절 등 매주 자동 적립 항목" },
  { value: "special", label: "특별 지급", desc: "찬양/예배 중 특별 지급 (5달란트 이내 등 가이드)" },
  { value: "bonus",   label: "누적 보너스", desc: "개근·정근·수료 등 누적 조건 충족 시" },
];

// 자동계산 매핑 가능한 시스템 키 (출석부 boolean 컬럼과 매칭)
const SYSTEM_WEEKLY_KEYS: { key: string; label: string; desc: string }[] = [
  { key: "attendance",    label: "출석",     desc: "attend_status='출' (출석체크 시)" },
  { key: "prayer",        label: "기도회",   desc: "had_prayer" },
  { key: "church_school", label: "교회학교", desc: "had_church_sch" },
  { key: "worship",       label: "예배",     desc: "had_worship" },
  { key: "lesson",        label: "공과",     desc: "had_lesson" },
  { key: "bible",         label: "성경읽기", desc: "had_bible" },
];

export default function TalentRulesPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [myGrade, setMyGrade] = useState<number | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Rule["rule_kind"]>("weekly");
  const [toast, setToast] = useState("");

  // 편집 모달
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      const gradeR = await supabase.rpc("get_user_grade", { p_dept_id: deptId });
      setMyGrade(typeof gradeR.data === "number" ? gradeR.data : Number(gradeR.data));
      await load();
    })();
  }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc("list_talent_rules", { p_dept_id: deptId });
    setLoading(false);
    if (error) { showToast("조회 실패: " + error.message); return; }
    setRules((data as Rule[]) || []);
  }

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(""), 2800); }
  const canEdit = myGrade !== null && myGrade <= 1;

  function openNew(kind: Rule["rule_kind"]) {
    setEditing({
      rule_kind: kind,
      rule_key: "",
      label: "",
      points: 0,
      notes: "",
      order_no: rules.filter(r => r.rule_kind === kind).length,
      is_active: true,
    });
  }

  function openEdit(r: Rule) {
    setEditing({ ...r });
  }

  async function handleSave() {
    if (!editing) return;
    if (!editing.label?.trim()) { showToast("이름을 입력하세요"); return; }
    if (!editing.rule_key?.trim()) { showToast("식별자(rule_key)를 입력하세요"); return; }
    setSaving(true);
    const { error } = await supabase.rpc("save_talent_rule", {
      p_id:       editing.id || null,
      p_dept_id:  deptId,
      p_kind:     editing.rule_kind,
      p_key:      editing.rule_key.trim(),
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
    if (!confirm(`"${r.label}" 규칙을 삭제하시겠습니까?`)) return;
    const { error } = await supabase.rpc("delete_talent_rule", { p_id: r.id });
    if (error) { showToast("삭제 실패: " + error.message); return; }
    showToast("삭제됨");
    await load();
  }

  if (!authChecked || loading) return <div style={loadingStyle}>로딩 중...</div>;

  if (!canEdit && rules.length === 0) {
    return (
      <div style={pageStyle}>
        <div style={{ maxWidth: 480, margin: "60px auto", padding: 24 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🏅</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b", marginBottom: 8 }}>달란트 규칙 미설정</div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>부장(grade 0~1) 만 규칙을 등록·수정할 수 있습니다</div>
            <button onClick={() => router.push(`/departments/d/${deptId}`)} style={primaryBtn}>← 부서홈</button>
          </div>
        </div>
      </div>
    );
  }

  const filtered = rules.filter(r => r.rule_kind === tab);

  return (
    <div style={pageStyle}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap" rel="stylesheet" />

      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtn}>← 부서홈</button>
          <HeaderLogo />
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>🏅 달란트 규칙</div>
        <div style={{ width: 60 }} />
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>

        {/* 탭 */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {KIND_TABS.map(t => (
            <button key={t.value} onClick={() => setTab(t.value)} style={{
              flex: 1, padding: "10px 6px", borderRadius: 10,
              background: tab === t.value ? "#6366f1" : "#fff",
              color: tab === t.value ? "#fff" : "#475569",
              border: tab === t.value ? "none" : "1.5px solid #e2e8f0",
              fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            }}>{t.label}</button>
          ))}
        </div>

        {/* 안내 */}
        <div style={{ background: "#fff", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 11, color: "#64748b", lineHeight: 1.7 }}>
          {KIND_TABS.find(t => t.value === tab)?.desc}
        </div>

        {/* 규칙 리스트 */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={sectionLabel}>{KIND_TABS.find(t => t.value === tab)?.label} ({filtered.length}개)</div>
            {canEdit && (
              <button onClick={() => openNew(tab)} style={addBtn}>+ 항목 추가</button>
            )}
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
              아직 항목이 없습니다.{canEdit ? " 우측 상단 [+ 항목 추가] 로 등록하세요." : ""}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {filtered.map(r => (
                <div key={r.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 10,
                  background: r.is_active ? "#f8fafc" : "#fff",
                  border: r.is_active ? "1px solid #e2e8f0" : "1.5px dashed #cbd5e1",
                  opacity: r.is_active ? 1 : 0.6,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>
                      {r.label}
                      {!r.is_active && <span style={{ marginLeft: 6, fontSize: 10, color: "#94a3b8" }}>비활성</span>}
                    </div>
                    {r.notes && <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{r.notes}</div>}
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2, fontFamily: "monospace" }}>
                      {r.rule_key}
                    </div>
                  </div>
                  <div style={{
                    minWidth: 56, textAlign: "center",
                    padding: "6px 10px", borderRadius: 8,
                    background: "#eef2ff", color: "#4338ca",
                    fontSize: 14, fontWeight: 800,
                  }}>
                    {r.points}
                  </div>
                  {canEdit && (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => openEdit(r)} style={smallBtn}>수정</button>
                      <button onClick={() => handleDelete(r)} style={{ ...smallBtn, color: "#b91c1c", background: "#fee2e2" }}>삭제</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {!canEdit && (
          <div style={{ marginTop: 14, fontSize: 11, color: "#94a3b8", textAlign: "center" }}>
            🔒 규칙 편집은 부장(등급 0~1) 권한이 필요합니다.
          </div>
        )}
      </div>

      {/* 편집 모달 */}
      {editing && (
        <div style={modalBackdrop} onClick={() => !saving && setEditing(null)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#1e293b" }}>
                {editing.id ? "규칙 수정" : "규칙 추가"} · {KIND_TABS.find(t => t.value === editing.rule_kind)?.label}
              </div>
              <button onClick={() => !saving && setEditing(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8" }}>×</button>
            </div>

            <label style={lbl}>이름 (화면 표시)</label>
            <input type="text" value={editing.label || ""} onChange={(e) => setEditing(s => ({ ...s!, label: e.target.value }))}
              placeholder="예: 출석, 헌금, 주보요절..." style={input} />

            <label style={lbl}>식별자 (영문/숫자)</label>
            {editing.rule_kind === "weekly" ? (
              <select value={editing.rule_key || ""} onChange={(e) => setEditing(s => ({ ...s!, rule_key: e.target.value }))} style={input}>
                <option value="">— 선택 (자동계산 매핑 또는 직접 입력) —</option>
                <optgroup label="자동계산 (출석부 연동)">
                  {SYSTEM_WEEKLY_KEYS.map(k => (
                    <option key={k.key} value={k.key}>{k.label} — {k.key}</option>
                  ))}
                </optgroup>
                <option value="__custom">직접 입력 (자동계산 X, 주별 수동 체크)</option>
              </select>
            ) : null}
            {(editing.rule_kind !== "weekly" || editing.rule_key === "__custom") && (
              <input type="text"
                value={editing.rule_key === "__custom" ? "" : (editing.rule_key || "")}
                onChange={(e) => setEditing(s => ({ ...s!, rule_key: e.target.value.replace(/[^a-z0-9_]/gi, "_").toLowerCase() }))}
                placeholder="예: offering, verse, guide_friend"
                style={input}
              />
            )}
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: -6, marginBottom: 8 }}>
              {editing.rule_kind === "weekly"
                ? "자동계산 키를 고르거나 직접 입력. 직접 입력은 출석부에 별도 체크박스로 표시됩니다."
                : "이 부서 안에서만 유니크하면 됩니다."}
            </div>

            <label style={lbl}>점수 (달란트)</label>
            <input type="number" value={editing.points ?? 0}
              onChange={(e) => setEditing(s => ({ ...s!, points: parseInt(e.target.value, 10) || 0 }))}
              style={input} />

            <label style={lbl}>설명/메모 (선택)</label>
            <textarea value={editing.notes || ""}
              onChange={(e) => setEditing(s => ({ ...s!, notes: e.target.value }))}
              rows={2}
              placeholder="예: 단, 교회 출석 주보 제출 시"
              style={{ ...input, resize: "vertical", minHeight: 50, fontFamily: "inherit" }} />

            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <input type="checkbox" id="active" checked={editing.is_active ?? true}
                onChange={(e) => setEditing(s => ({ ...s!, is_active: e.target.checked }))} />
              <label htmlFor="active" style={{ fontSize: 12, color: "#475569", cursor: "pointer" }}>활성</label>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => !saving && setEditing(null)} disabled={saving}
                style={{ flex: 1, padding: "10px", background: "#f1f5f9", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }}>취소</button>
              <button onClick={handleSave} disabled={saving}
                style={{ flex: 2, padding: "10px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, color: "#fff", cursor: saving ? "wait" : "pointer", fontFamily: "inherit" }}>
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

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" };
const loadingStyle: React.CSSProperties = { ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center" };
const headerStyle: React.CSSProperties = { background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" };
const card: React.CSSProperties = { background: "#fff", borderRadius: 14, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" };
const sectionLabel: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: "#475569", letterSpacing: 0.5 };
const backBtn: React.CSSProperties = { padding: "8px 14px", background: "#f1f5f9", border: "none", borderRadius: 8, fontSize: 12, color: "#475569", cursor: "pointer", fontFamily: "inherit" };
const primaryBtn: React.CSSProperties = { padding: "10px 20px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const addBtn: React.CSSProperties = { padding: "6px 12px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", border: "none", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const smallBtn: React.CSSProperties = { padding: "5px 10px", background: "#f1f5f9", color: "#475569", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginTop: 8, marginBottom: 4 };
const input: React.CSSProperties = { width: "100%", padding: "8px 10px", fontSize: 13, border: "1.5px solid #cbd5e1", borderRadius: 8, fontFamily: "inherit", boxSizing: "border-box", marginBottom: 8 };
const modalBackdrop: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 };
const modalBox: React.CSSProperties = { background: "#fff", borderRadius: 14, padding: 20, width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto", fontFamily: "inherit" };
const toastStyle: React.CSSProperties = { position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(15,23,42,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 13, fontWeight: 600, zIndex: 1100, fontFamily: "inherit", whiteSpace: "nowrap" };
