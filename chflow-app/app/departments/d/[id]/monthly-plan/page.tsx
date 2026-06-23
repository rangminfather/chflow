"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { CalendarDays, List, ChevronLeft, ChevronRight, FileDown, FileText, Settings2, Trash2, CalendarPlus } from "lucide-react";
import PdfCanvasViewer from "@/components/PdfCanvasViewer";
import { PlanMonthView, type PlanWeek } from "@/components/MonthlyPlanCards";

interface PlanFile {
  name: string;
  path: string;
  url: string;
  year: number | null;
  month: number | null;
  originalName: string;
  created_at: string | null;
  size: number | null;
}

interface CardMonth {
  key: string;        // "YYYY-MM"
  year: number;
  month: number;
  weeks: PlanWeek[];
  notes: string[];
}

type NavGroup =
  | { key: string; year: number; month: number; label: string; kind: "cards"; weeks: PlanWeek[]; notes: string[] }
  | { key: string; year: number; month: number; label: string; kind: "files"; files: PlanFile[] };

function isImage(url: string) { return /\.(jpe?g|png|gif|webp|bmp|svg)(\?|$)/i.test(url); }
function isPdf(url: string) { return /\.pdf(\?|$)/i.test(url); }
function isXlsx(url: string) { return /\.xlsx(\?|$)/i.test(url); }
function pad2(n: number) { return String(n).padStart(2, "0"); }

// 양식 불일치 xlsx 폴백 — 서버에서 표(HTML)로 파싱해 인라인 표출
function XlsxTableView({ path }: { path: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/edu/monthly-plans/render?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok || !json.ok) { setErr(json.error || "표 변환 실패"); return; }
      setHtml(json.html || "");
    })();
    return () => { cancelled = true; };
  }, [path]);

  if (err) return <div style={{ padding: 16, color: "var(--danger)", fontSize: 13 }}>{err}</div>;
  if (html === null) return <div style={{ padding: 24, textAlign: "center", color: "var(--ink-faint)", fontSize: 13 }}>표 변환 중...</div>;
  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--hairline)", borderRadius: 12, background: "var(--card)", padding: 12 }}>
      <style>{`
        .mp-sheet + .mp-sheet { margin-top: 18px; }
        .mp-sheet-name { font-size: 12px; font-weight: 700; color: var(--ink-faint); margin-bottom: 6px; }
        .mp-table { border-collapse: collapse; font-size: 12px; color: var(--ink); }
        .mp-table td { border: 1px solid var(--hairline); padding: 4px 7px; white-space: nowrap; vertical-align: middle; }
      `}</style>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

export default function MonthlyPlanPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<PlanFile[]>([]);
  const [cardMonths, setCardMonths] = useState<CardMonth[]>([]);
  const [commonNotes, setCommonNotes] = useState<string[]>([]);
  const [cardPaths, setCardPaths] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [showList, setShowList] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null); // "YYYY-MM"
  const [grade, setGrade] = useState<number | null>(null);
  const [managing, setManaging] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);

  const canManage = grade !== null && grade <= 2;

  const now = new Date();
  const currentKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      const gradeResp = await supabase.rpc("get_user_grade", { p_dept_id: deptId });
      setGrade(typeof gradeResp.data === "number" ? gradeResp.data : Number(gradeResp.data));
      await loadFiles(session.access_token);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, deptId]);

  async function loadFiles(token: string) {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/edu/monthly-plans?dept_id=${deptId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await res.json();
    if (!res.ok || !result.ok) { setLoading(false); setError(result.error || "조회 실패"); return; }
    const list: PlanFile[] = result.files || [];
    setFiles(list);

    // xlsx → 카드 파싱 (최신 업로드 우선). 양식 안 맞으면 표 폴백으로 남김.
    const xlsxFiles = list.filter((f) => isXlsx(f.url)); // list는 created_at desc
    const parsed = await Promise.all(
      xlsxFiles.map(async (f) => {
        const r = await fetch(`/api/edu/monthly-plans/render?path=${encodeURIComponent(f.path)}&format=cards`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const j = await r.json().catch(() => ({}));
        return { file: f, json: j as { ok?: boolean; template?: boolean; year?: number; common?: string[]; months?: Array<{ month: number; weeks: PlanWeek[]; notes: string[] }> } };
      })
    );

    const monthMap = new Map<string, CardMonth>();
    const consumed = new Set<string>();
    let common: string[] = [];
    for (const { file, json } of parsed) {
      if (!json?.ok || !json.template || !json.months) continue;
      consumed.add(file.path);
      if (common.length === 0 && json.common?.length) common = json.common;
      const yr = json.year || (file.year ?? now.getFullYear());
      for (const m of json.months) {
        const key = `${yr}-${pad2(m.month)}`;
        if (!monthMap.has(key)) {
          monthMap.set(key, { key, year: yr, month: m.month, weeks: m.weeks, notes: m.notes });
        }
      }
    }
    setCardMonths(Array.from(monthMap.values()));
    setCommonNotes(common);
    setCardPaths(consumed);
    setLoading(false);
  }

  async function handleDelete(f: PlanFile) {
    if (!window.confirm(`"${f.originalName}" 파일을 삭제할까요?\n이 파일에서 만들어진 월 카드가 모두 사라집니다.`)) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace("/login"); return; }
    setBusyPath(f.path);
    const res = await fetch(`/api/edu/monthly-plans?dept_id=${deptId}&path=${encodeURIComponent(f.path)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const j = await res.json().catch(() => ({}));
    setBusyPath(null);
    if (!res.ok || !j.ok) { alert(j.error || "삭제에 실패했습니다."); return; }
    setSelectedKey(null);
    await loadFiles(session.access_token);
  }

  // 월별 통합 그룹: 카드 월 + (비대상 파일: 이미지·PDF·양식불일치 xlsx). 같은 달이면 카드 우선.
  const groups: NavGroup[] = useMemo(() => {
    const map = new Map<string, NavGroup>();
    for (const cm of cardMonths) {
      map.set(cm.key, { key: cm.key, year: cm.year, month: cm.month, label: `${cm.year}년 ${cm.month}월`, kind: "cards", weeks: cm.weeks, notes: cm.notes });
    }
    for (const f of files) {
      if (!f.year || !f.month) continue;
      if (cardPaths.has(f.path)) continue; // 카드로 소비된 xlsx 제외
      if (!isImage(f.url) && !isPdf(f.url) && !isXlsx(f.url)) continue;
      const key = `${f.year}-${pad2(f.month)}`;
      const existing = map.get(key);
      if (existing) {
        if (existing.kind === "cards") continue; // 카드 우선
        existing.files.push(f);
      } else {
        map.set(key, { key, year: f.year, month: f.month, label: `${f.year}년 ${f.month}월`, kind: "files", files: [f] });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.key.localeCompare(a.key));
  }, [cardMonths, cardPaths, files]);

  const activeGroup = useMemo(() => {
    if (groups.length === 0) return null;
    if (selectedKey) return groups.find((g) => g.key === selectedKey) ?? groups[0];
    const cur = groups.find((g) => g.key === currentKey);
    return cur ?? groups[0];
  }, [groups, selectedKey, currentKey]);

  const activeIdx = activeGroup ? groups.indexOf(activeGroup) : -1;

  function selectGroup(g: NavGroup) {
    setSelectedKey(g.key);
    setShowList(false);
  }

  if (!authChecked) return <LoadingView full />;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" }}>
      {/* 헤더 */}
      <div className="app-subpage-header" style={{ background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", gap: 8 }}>
        <HeaderLogo />
        <button className="app-header-back" onClick={() => router.push(`/departments/d/${deptId}`)} style={{ padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>← 부서홈</button>
        <div style={{ flex: 1, fontSize: 17, fontWeight: 800, color: "var(--ink)", display: "flex", alignItems: "center", gap: 6 }}>
          <CalendarDays size={17} strokeWidth={1.8} /> 월간 교육계획서
        </div>
        {!managing && groups.length > 1 && (
          <button
            className="app-header-actions"
            onClick={() => setShowList((v) => !v)}
            style={{ padding: "7px 12px", background: showList ? "var(--accent-soft)" : "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 13, color: showList ? "var(--accent)" : "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5, fontWeight: 600 }}
          >
            <List size={15} strokeWidth={2} /> 목록
          </button>
        )}
        {canManage && (
          <button
            className="app-header-actions"
            onClick={() => { setManaging((v) => !v); setShowList(false); }}
            style={{ padding: "7px 12px", background: managing ? "var(--accent-soft)" : "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 13, color: managing ? "var(--accent)" : "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5, fontWeight: 600 }}
          >
            <Settings2 size={15} strokeWidth={2} /> 관리
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ padding: "48px 0", textAlign: "center" }}><LoadingView /></div>
      ) : error ? (
        <div style={{ padding: "48px 16px", textAlign: "center", color: "var(--danger)", fontWeight: 700 }}>{error}</div>
      ) : managing ? (
        /* ── 관리 모드 (권한자) ── */
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-soft)", lineHeight: 1.6, marginBottom: 12 }}>
            업로드한 파일을 삭제할 수 있습니다. 내용을 바꾸려면 새로 올려 교체하세요.
          </div>
          <button
            onClick={() => router.push(`/departments/d/${deptId}/monthly-plan-upload`)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "12px", marginBottom: 14, borderRadius: 12, background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 700 }}
          >
            <CalendarPlus size={16} strokeWidth={2} /> 새 교육계획 올리기
          </button>
          {files.length === 0 ? (
            <EmptyState message="등록된 파일이 없습니다" />
          ) : (
            files.map((f) => (
              <div key={f.path} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", marginBottom: 8, borderRadius: 12, background: "var(--card)", border: "1px solid var(--hairline)" }}>
                <FileText size={20} strokeWidth={1.8} color="var(--ink-faint)" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", wordBreak: "break-all" }}>{f.originalName}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 2 }}>
                    {f.created_at ? new Date(f.created_at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" }) : "날짜 미상"}
                    {f.size ? ` · ${(f.size / 1024).toFixed(0)}KB` : ""}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(f)}
                  disabled={busyPath === f.path}
                  style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 12px", borderRadius: 9, background: "color-mix(in srgb, var(--danger) 10%, transparent)", color: "var(--danger)", border: "none", cursor: busyPath === f.path ? "default" : "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, opacity: busyPath === f.path ? 0.5 : 1 }}
                >
                  <Trash2 size={14} strokeWidth={2} /> {busyPath === f.path ? "삭제 중" : "삭제"}
                </button>
              </div>
            ))
          )}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState message="등록된 월간 교육계획서가 없습니다" hint="월간교육등록에서 파일을 올리면 이 화면에 표시됩니다." />
      ) : showList ? (
        /* ── 목록 모드 ── */
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px" }}>
          {groups.map((g) => {
            const isCurrent = g.key === currentKey;
            const isActive = activeGroup && activeGroup.key === g.key;
            const sub = g.kind === "cards" ? `주일 ${g.weeks.length}개` : `파일 ${g.files.length}개`;
            return (
              <button
                key={g.key}
                onClick={() => selectGroup(g)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "14px 18px", marginBottom: 8, borderRadius: 12,
                  background: isActive ? "var(--accent-soft)" : "var(--card)",
                  border: `1px solid ${isActive ? "var(--accent)" : "var(--hairline)"}`,
                  cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                }}
              >
                <div>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{g.label}</span>
                  {isCurrent && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "var(--accent)", background: "var(--accent-soft)", padding: "2px 7px", borderRadius: 99 }}>이번 달</span>}
                  <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 2 }}>{sub}</div>
                </div>
                <ChevronRight size={16} strokeWidth={2} color="var(--ink-faint)" />
              </button>
            );
          })}
        </div>
      ) : (
        /* ── 뷰어 모드 ── */
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "12px 12px 40px" }}>
          {activeGroup && (
            <>
              {/* 월 내비게이션 */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <button
                  onClick={() => activeIdx < groups.length - 1 && selectGroup(groups[activeIdx + 1])}
                  disabled={activeIdx >= groups.length - 1}
                  style={{ padding: "6px 10px", border: "none", borderRadius: 8, background: "var(--bg-soft)", cursor: activeIdx >= groups.length - 1 ? "default" : "pointer", opacity: activeIdx >= groups.length - 1 ? 0.3 : 1 }}
                >
                  <ChevronLeft size={18} strokeWidth={2} />
                </button>
                <div style={{ fontWeight: 800, fontSize: 17, color: "var(--ink)", display: "flex", alignItems: "center", gap: 8 }}>
                  {activeGroup.label}
                  {activeGroup.key === currentKey && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", background: "var(--accent-soft)", padding: "2px 7px", borderRadius: 99 }}>이번 달</span>
                  )}
                </div>
                <button
                  onClick={() => activeIdx > 0 && selectGroup(groups[activeIdx - 1])}
                  disabled={activeIdx <= 0}
                  style={{ padding: "6px 10px", border: "none", borderRadius: 8, background: "var(--bg-soft)", cursor: activeIdx <= 0 ? "default" : "pointer", opacity: activeIdx <= 0 ? 0.3 : 1 }}
                >
                  <ChevronRight size={18} strokeWidth={2} />
                </button>
              </div>

              {/* 내용: 카드 또는 파일 */}
              {activeGroup.kind === "cards" ? (
                <PlanMonthView
                  year={activeGroup.year}
                  month={activeGroup.month}
                  common={commonNotes}
                  weeks={activeGroup.weeks}
                  notes={activeGroup.notes}
                />
              ) : (
                activeGroup.files.map((file, i) => (
                  <div key={file.name} style={{ marginBottom: 16 }}>
                    {activeGroup.files.length > 1 && (
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-faint)", marginBottom: 6, paddingLeft: 2 }}>
                        {i + 1} / {activeGroup.files.length}
                      </div>
                    )}
                    {isImage(file.url) ? (
                      <img
                        src={file.url}
                        alt={file.originalName}
                        style={{ width: "100%", borderRadius: 12, display: "block", boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}
                        loading={i === 0 ? "eager" : "lazy"}
                      />
                    ) : isPdf(file.url) ? (
                      <div style={{ width: "100%", height: "80vh", borderRadius: 12, border: "1px solid var(--hairline)", overflow: "hidden", background: "var(--card)" }}>
                        <PdfCanvasViewer key={file.url} url={`${file.url}?stream=1`} fallbackUrl={`${file.url}?download=1`} />
                      </div>
                    ) : isXlsx(file.url) ? (
                      <XlsxTableView path={file.path} />
                    ) : (
                      <div style={{ padding: "22px 18px", borderRadius: 12, background: "var(--card)", border: "1px solid var(--hairline)", textAlign: "center" }}>
                        <div style={{ display: "inline-flex", marginBottom: 10, color: "var(--ink-faint)" }}>
                          <FileText size={32} strokeWidth={1.6} />
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", marginBottom: 4, wordBreak: "break-all" }}>{file.originalName}</div>
                        <div style={{ fontSize: 12, color: "var(--ink-faint)", marginBottom: 14 }}>이 형식은 미리보기를 지원하지 않습니다. 내려받아 확인하세요.</div>
                        <a
                          href={`${file.url}?download=1`}
                          style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 18px", borderRadius: 10, background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 14, textDecoration: "none" }}
                        >
                          <FileDown size={16} strokeWidth={2} /> 다운로드
                        </a>
                      </div>
                    )}
                  </div>
                ))
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
