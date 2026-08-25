"use client";

// 달란트잔치 — 잔치 준비(통장 출력)와 잔치 마무리(반기 리셋)를 한 화면에서.
// 나이가 있는 행정 담당자도 헤매지 않도록 ①→② 순서의 큰 버튼으로 구성.
// 같은 기능이 달란트통계(출력)·출결통합조회 달란트체크(리셋)에도 있으며 동작은 동일하다.

import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { useConfirm } from "@/components/ConfirmDialog";
import TalentPassbookPrint from "@/components/TalentPassbookPrint";
import { Lock, PartyPopper, Printer, RotateCcw } from "lucide-react";
import {
  type StudentTotal,
  fetchActiveStudents,
  buildHalfTotals,
  sortForHandout,
} from "@/lib/talentAggregate";
import {
  type TalentReset,
  type HalfOption,
  fetchTalentResets,
  insertTalentReset,
  deleteTalentReset,
  formatResetDate,
  recentEndedHalves,
} from "@/lib/talentReset";

type HalfKey = "h1" | "h2";

// 잔치 시기 기준 기본 선택: 연초(1~2월)=작년 하반기, 3~8월=올해 상반기, 9~12월=올해 하반기
function defaultFeastPeriod(): { year: number; half: HalfKey } {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (month <= 2) return { year: year - 1, half: "h2" };
  if (month <= 8) return { year, half: "h1" };
  return { year, half: "h2" };
}

function halfRange(year: number, half: HalfKey) {
  return half === "h1"
    ? { from: `${year}-01-01`, to: `${year}-06-30`, label: `${year}년 상반기` }
    : { from: `${year}-07-01`, to: `${year}-12-31`, label: `${year}년 하반기` };
}

export default function TalentFeastPage() {
  const router = useRouter();
  const { confirm } = useConfirm();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(true);

  // ① 통장 출력
  const initial = defaultFeastPeriod();
  const [year, setYear] = useState(initial.year);
  const [half, setHalf] = useState<HalfKey>(initial.half);
  const [printLoading, setPrintLoading] = useState(false);
  const [printItems, setPrintItems] = useState<StudentTotal[] | null>(null);

  // ② 리셋
  const [lastReset, setLastReset] = useState<TalentReset | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [toast, setToast] = useState("");

  const loadResets = useCallback(async () => {
    const resets = await fetchTalentResets(deptId);
    setLastReset(resets[0] || null);
  }, [deptId]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);

      const { data: gradeData } = await supabase.rpc("get_user_grade", { p_dept_id: deptId });
      const grade = typeof gradeData === "number" ? gradeData : Number(gradeData);
      if (Number.isNaN(grade) || grade > 2) {
        setAuthorized(false);
        return;
      }
      setAuthorized(true);
      await loadResets();
    })();
  }, [deptId, router, loadResets]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  // 통장 출력 — 누를 때 선택 기간을 집계해서 인쇄 화면을 연다
  const openPrint = async () => {
    setPrintLoading(true);
    const students = await fetchActiveStudents(deptId);
    if (students.length === 0) {
      setPrintLoading(false);
      showToast("출력할 학생이 없습니다");
      return;
    }
    const range = halfRange(year, half);
    const totals = await buildHalfTotals(deptId, students, range.from, range.to);
    setPrintItems(sortForHandout(totals));
    setPrintLoading(false);
  };

  // 반기 리셋 — 출결통합조회 달란트체크와 동일 동작
  const applyReset = async (option: HalfOption) => {
    const ok = await confirm(
      `${option.label} 달란트 집계를 리셋할까요?\n\n${formatResetDate(option.endDate)}까지 적립분이 잔치 정산으로 처리되고, 그 이후 적립분은 그대로 유지됩니다.\n기록은 삭제되지 않으며 '리셋 취소'로 되돌릴 수 있습니다.`,
      { okText: "리셋" },
    );
    if (!ok) return;
    setResetBusy(true);
    const errMsg = await insertTalentReset(deptId, option.endDate);
    setResetBusy(false);
    if (errMsg) { showToast(`리셋 실패: ${errMsg}`); return; }
    await loadResets();
    showToast(`${option.label} 달란트가 리셋되었습니다`);
  };

  const undoReset = async () => {
    if (!lastReset) return;
    const ok = await confirm(
      `마지막 리셋(${formatResetDate(lastReset.reset_date)}까지 정산)을 취소할까요?\n리셋 이전 적립분이 다시 총 달란트에 합산됩니다.`,
      { okText: "리셋 취소" },
    );
    if (!ok) return;
    setResetBusy(true);
    const errMsg = await deleteTalentReset(lastReset.id);
    setResetBusy(false);
    if (errMsg) { showToast(`취소 실패: ${errMsg}`); return; }
    await loadResets();
    showToast("리셋이 취소되었습니다");
  };

  if (!authChecked) return <LoadingView full />;

  if (!authorized) {
    return (
      <div style={pageStyle}>
        <PageHeader deptId={deptId} router={router} />
        <main className="mx-auto max-w-lg px-4 py-14">
          <div className="rounded-lg border border-hairline bg-card text-center">
            <EmptyState
              icon={<Lock size={24} strokeWidth={1.8} />}
              message="접근 권한이 없습니다"
              hint="달란트잔치는 임원진(전도사·부장·부부장·총무·서기·회계 등)만 이용할 수 있습니다"
            />
          </div>
        </main>
      </div>
    );
  }

  const selectedRange = halfRange(year, half);

  return (
    <div style={pageStyle}>
      <PageHeader deptId={deptId} router={router} />

      <main className="mx-auto w-full max-w-lg px-4 py-5">
        {/* ① 통장 출력 */}
        <section className="mb-5 rounded-xl border border-hairline bg-card p-5">
          <div className="mb-1 text-[18px] font-extrabold text-ink">① 달란트통장 출력</div>
          <p className="mb-4 text-[14px] leading-6 text-ink-soft">
            잔치 전에 학생별 달란트통장을 출력해서 나눠주세요.
            A4 한 장에 8명씩 나오고, 점선대로 자르면 됩니다.
          </p>

          <div className="mb-3 flex items-center justify-center gap-2">
            <button type="button" onClick={() => setYear(year - 1)} style={navBtnStyle}>◀</button>
            <div className="min-w-[92px] text-center text-[18px] font-extrabold text-ink">{year}년</div>
            <button type="button" onClick={() => setYear(year + 1)} style={navBtnStyle}>▶</button>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2">
            {([
              { key: "h1", label: "상반기", sub: "1월~6월" },
              { key: "h2", label: "하반기", sub: "7월~12월" },
            ] as const).map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setHalf(option.key)}
                className="min-h-14 rounded-lg border text-center"
                style={half === option.key
                  ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" }
                  : { borderColor: "var(--hairline)", background: "var(--bg-soft)", color: "var(--ink-soft)" }}
              >
                <span className="block text-[16px] font-extrabold">{option.label}</span>
                <span className="block text-[12px] font-semibold">{option.sub}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={openPrint}
            disabled={printLoading}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg text-[17px] font-extrabold text-white disabled:opacity-60"
            style={{ background: "var(--accent)" }}
          >
            <Printer size={19} strokeWidth={2.2} />
            {printLoading ? "통장 집계 중..." : `${selectedRange.label} 통장 출력하기`}
          </button>
        </section>

        {/* ② 리셋 */}
        <section className="rounded-xl border border-hairline bg-card p-5">
          <div className="mb-1 text-[18px] font-extrabold text-ink">② 잔치가 끝나면 달란트 리셋</div>
          <p className="mb-4 text-[14px] leading-6 text-ink-soft">
            잔치에서 달란트를 다 쓴 뒤 눌러주세요. 선택한 반기까지 모은 달란트만 정산되고,
            그 이후에 체크된 달란트는 그대로 남습니다. 몇 주 늦게 눌러도 괜찮습니다.
          </p>

          <div className="mb-3 text-[13px] font-bold text-ink-faint">
            {lastReset
              ? `마지막 정산: ${formatResetDate(lastReset.reset_date)}까지 완료`
              : "아직 정산한 적이 없습니다"}
          </div>

          <div className="flex flex-col gap-2">
            {recentEndedHalves().map((option) => (
              <button
                key={option.endDate}
                type="button"
                onClick={() => applyReset(option)}
                disabled={resetBusy}
                className="flex min-h-14 items-center justify-between gap-2 rounded-lg border px-4 text-left disabled:opacity-60"
                style={{
                  borderColor: "color-mix(in srgb, var(--danger) 35%, transparent)",
                  background: "color-mix(in srgb, var(--danger) 6%, var(--card))",
                }}
              >
                <span className="inline-flex items-center gap-2 text-[16px] font-extrabold" style={{ color: "var(--danger)" }}>
                  <RotateCcw size={17} strokeWidth={2.2} /> {option.label} 리셋
                </span>
                <span className="text-[12px] font-semibold text-ink-faint">~{formatResetDate(option.endDate)} 정산</span>
              </button>
            ))}
            {lastReset && (
              <button
                type="button"
                onClick={undoReset}
                disabled={resetBusy}
                className="min-h-11 rounded-lg border border-hairline bg-bg-soft text-[14px] font-bold text-ink-soft disabled:opacity-60"
              >
                리셋 취소 (마지막 정산 되돌리기)
              </button>
            )}
          </div>
        </section>
      </main>

      {printItems && (
        <TalentPassbookPrint
          periodLabel={selectedRange.label}
          items={printItems}
          onClose={() => setPrintItems(null)}
        />
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

function PageHeader({ deptId, router }: { deptId: string; router: ReturnType<typeof useRouter> }) {
  return (
    <div className="app-subpage-header" style={headerStyle}>
      <HeaderLogo />
      <button className="app-header-back" onClick={() => router.back()} style={backBtnStyle}>← 뒤로</button>
      <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <PartyPopper size={18} strokeWidth={1.8} /> 달란트잔치
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif", overflowX: "hidden" };
const headerStyle: CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
const titleStyle: CSSProperties = { fontSize: 19, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 };
const backBtnStyle: CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
const navBtnStyle: CSSProperties = { padding: "8px 16px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 15, cursor: "pointer", fontFamily: "inherit", color: "var(--ink-mid)" };
const toastStyle: CSSProperties = { position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(43, 39, 34,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 14, fontWeight: 700, zIndex: 1100, fontFamily: "inherit", whiteSpace: "nowrap" };
