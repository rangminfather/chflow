"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { CalendarDays, List, ChevronLeft, ChevronRight, FileDown, FileText } from "lucide-react";
import PdfCanvasViewer from "@/components/PdfCanvasViewer";

interface PlanFile {
  name: string;
  url: string;
  year: number | null;
  month: number | null;
  originalName: string;
  created_at: string | null;
  size: number | null;
}

interface MonthGroup {
  year: number;
  month: number;
  label: string;
  files: PlanFile[];
}

function isImage(url: string) {
  return /\.(jpe?g|png|gif|webp|bmp|svg)(\?|$)/i.test(url);
}

function isPdf(url: string) {
  return /\.pdf(\?|$)/i.test(url);
}

export default function MonthlyPlanPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<PlanFile[]>([]);
  const [error, setError] = useState("");
  const [showList, setShowList] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null); // "YYYY-MM"

  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
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
    setLoading(false);
    if (!res.ok || !result.ok) { setError(result.error || "조회 실패"); return; }
    setFiles(result.files || []);
  }

  // 월별 그룹핑, 최신순 정렬
  const groups: MonthGroup[] = useMemo(() => {
    const map = new Map<string, PlanFile[]>();
    for (const f of files) {
      if (!f.year || !f.month) continue;
      const key = `${f.year}-${String(f.month).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(f);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, flist]) => {
        const [y, m] = key.split("-").map(Number);
        return { year: y, month: m, label: `${y}년 ${m}월`, files: flist };
      });
  }, [files]);

  // 선택된 그룹 결정: 선택키 > 현재달 > 최신달
  const activeGroup = useMemo(() => {
    if (groups.length === 0) return null;
    if (selectedKey) return groups.find((g) => `${g.year}-${String(g.month).padStart(2, "0")}` === selectedKey) ?? groups[0];
    const cur = groups.find((g) => `${g.year}-${String(g.month).padStart(2, "0")}` === currentKey);
    return cur ?? groups[0];
  }, [groups, selectedKey, currentKey]);

  const activeIdx = activeGroup ? groups.indexOf(activeGroup) : -1;

  function selectGroup(g: MonthGroup) {
    setSelectedKey(`${g.year}-${String(g.month).padStart(2, "0")}`);
    setShowList(false);
  }

  if (!authChecked) return <LoadingView full />;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" }}>
      {/* 헤더 */}
      <div style={{ background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", gap: 8 }}>
        <HeaderLogo />
        <button onClick={() => router.push(`/departments/d/${deptId}`)} style={{ padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>← 부서홈</button>
        <div style={{ flex: 1, fontSize: 17, fontWeight: 800, color: "var(--ink)", display: "flex", alignItems: "center", gap: 6 }}>
          <CalendarDays size={17} strokeWidth={1.8} /> 월간 교육계획서
        </div>
        {groups.length > 1 && (
          <button
            onClick={() => setShowList((v) => !v)}
            style={{ padding: "7px 12px", background: showList ? "var(--accent-soft)" : "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 13, color: showList ? "var(--accent)" : "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5, fontWeight: 600 }}
          >
            <List size={15} strokeWidth={2} /> 목록
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ padding: "48px 0", textAlign: "center" }}><LoadingView /></div>
      ) : error ? (
        <div style={{ padding: "48px 16px", textAlign: "center", color: "var(--danger)", fontWeight: 700 }}>{error}</div>
      ) : groups.length === 0 ? (
        <EmptyState message="등록된 월간 교육계획서가 없습니다" hint="월간교육등록에서 파일을 올리면 이 화면에 표시됩니다." />
      ) : showList ? (
        /* ── 목록 모드 ── */
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px" }}>
          {groups.map((g) => {
            const key = `${g.year}-${String(g.month).padStart(2, "0")}`;
            const isCurrent = key === currentKey;
            const isActive = activeGroup && `${activeGroup.year}-${String(activeGroup.month).padStart(2, "0")}` === key;
            return (
              <button
                key={key}
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
                  <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 2 }}>파일 {g.files.length}개</div>
                </div>
                <ChevronRight size={16} strokeWidth={2} color="var(--ink-faint)" />
              </button>
            );
          })}
        </div>
      ) : (
        /* ── 뷰어 모드 ── */
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "12px 12px 40px" }}>
          {/* 월 내비게이션 */}
          {activeGroup && (
            <>
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
                  {`${activeGroup.year}-${String(activeGroup.month).padStart(2, "0")}` === currentKey && (
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

              {/* 파일들 */}
              {activeGroup.files.map((file, i) => (
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
                      <PdfCanvasViewer key={file.url} url={file.url} fallbackUrl={`${file.url}?download=1`} />
                    </div>
                  ) : (
                    /* 엑셀·한글 등 브라우저가 이미지로 못 띄우는 형식 → 다운로드 카드 */
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
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
