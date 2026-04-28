"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────────
// 폼 정의 — PROJECT_BRIEF 분석 기반 19개 항목 + 호수
// ─────────────────────────────────────────────────────────────────
const EMPTY_FORM = {
  date: "",                  // YYYY-MM-DD (일요일)

  // 1부 예배 명단/멘트
  guide: "",                 // 안내
  praise1: "",               // 찬양 1
  praise2: "",               // 찬양 2
  leader: "",                // 예배인도 부장
  theme: "",                 // 주제제창 멘트
  prayerClass: "",           // 기도 (반, 예: "2-3")
  scripture: "",             // 성경봉독 (예: "창세기 11장 1~9절")
  sermonTitle: "",           // 강론 제목
  preacher: "",              // 강론자
  nextPrayer: "",            // 다음 주 기도 (예: "3-4반" or "김정권장로님")

  // 헌금
  tithe: "",                 // 십일조 금액 (예: "50,000원")
  thanksgiving: "",          // 감사헌금 금액

  // 공과
  lessonNum: "",             // 공과 회차 (예: "14")
  q1: "",                    // 퀴즈 1번 문제
  q1c1: "",                  // 보기 ①
  q1c2: "",
  q1c3: "",
  q1c4: "",
  q2: "",                    // 퀴즈 2번 문제

  // 새 친구
  newFriend: "",             // 새 친구 이름
};

type FormState = typeof EMPTY_FORM;

const SUPPORTED_DEPT = "초등1부";
const STORAGE_KEY = "chflow:weekly-bulletin-draft:";  // + deptId

// ─────────────────────────────────────────────────────────────────
// 호수 계산 — 1월 첫 일요일 = 1호, 매주 일요일마다 1호씩 증가
// 형식: "제YY-NN호" (YY = 연도 마지막 2자리, NN = 일요일 회차)
// ─────────────────────────────────────────────────────────────────
function calcIssueNumber(dateStr: string): { yy: number; nn: number; label: string } | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  if (d.getDay() !== 0) return null; // 일요일이 아니면 null (호수 정의 자체가 일요일 기준)

  const year = d.getFullYear();
  // 1월 1일부터 d 까지 일요일 개수
  const jan1 = new Date(year, 0, 1);
  // 첫 일요일 찾기
  const firstSun = new Date(jan1);
  while (firstSun.getDay() !== 0) firstSun.setDate(firstSun.getDate() + 1);
  // 첫 일요일과 d 사이 주 차이 + 1
  const diffDays = Math.round((d.getTime() - firstSun.getTime()) / (1000 * 60 * 60 * 24));
  const nn = Math.floor(diffDays / 7) + 1;
  const yy = year % 100;
  return { yy, nn, label: `제${yy}-${nn}호` };
}

function nextSundayDate(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 0 : 7 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function formatKoreanDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// ─────────────────────────────────────────────────────────────────
// hwpx 치환 매핑 — 원본 23.08.20 hwpx 의 OLD 값을 USER_INPUT 으로
// (OLD 값은 anchor 역할. 템플릿이 바뀌면 이 매핑도 갱신 필요)
// ─────────────────────────────────────────────────────────────────
function buildReplacements(form: FormState): Record<string, string> {
  return {
    "2023년 8월 20일": formatKoreanDate(form.date),

    "✿안내 :김찬규 선생님": `✿안내 : ${form.guide || "(미입력)"} 선생님`,
    "신예슬 최성현 선생님": `${form.praise1 || ""} ${form.praise2 || ""} 선생님`,
    "최성헌부장선생님": `${form.leader || "(미입력)"}부장선생님`,
    "복음 들고 GO! 땅끝까지 GOGO!": form.theme || "(주제 미입력)",
    "1-1반 어린이": `${form.prayerClass || "?"}반 어린이`,
    "데살로니가후서 2장 13~17절": form.scripture || "(성경본문 미입력)",
    "교회는 무엇을 지켜야 하나요?": form.sermonTitle || "(설교제목 미입력)",
    "김희숙전도사님": `${form.preacher || "?"}전도사님`,
    "✿다음 주 기도 : 3-4반": `✿다음 주 기도 : ${form.nextPrayer || "(미입력)"}`,

    "십일조 : ": `십일조 : ${form.tithe || ""}`,
    "감사헌금 : ": `감사헌금 : ${form.thanksgiving || ""}`,

    "25과 공과 퀴즈 ": `${form.lessonNum || "?"}과 공과 퀴즈 `,
    "1. 주의 날에 대한 설명으로 바른 것은 무엇인가요?": `1. ${form.q1 || "(문제 미입력)"}`,
    "   ① 때와 시기는 우리가 알지 못한다.  ": `   ① ${form.q1c1 || ""}  `,
    "   ② 열심히 계산하면 알 수 있다.  ": `   ② ${form.q1c2 || ""}  `,
    "   ③ 모르니까 준비하지 않아도 된다.  ": `   ③ ${form.q1c3 || ""}  `,
    "   ④ 주의 날이 오지 않을 수도 있다.": `   ④ ${form.q1c4 || ""}`,
    " 2. 예수님을 믿는 우리는 어떻게 살아가야 하나요?": ` 2. ${form.q2 || ""}`,

    "   영 상": form.newFriend || "(미입력)",
  };
}

// ─────────────────────────────────────────────────────────────────
// hwpx 생성 — JSZip 으로 템플릿 fetch → section0.xml 치환 → zip 재구성
// ─────────────────────────────────────────────────────────────────
async function generateHwpx(form: FormState): Promise<Blob> {
  const JSZipMod = (await import("jszip")).default;

  const res = await fetch("/templates/elem1-bulletin-template.hwpx");
  if (!res.ok) throw new Error(`템플릿 로드 실패: ${res.status}`);
  const templateBuf = await res.arrayBuffer();

  const inZip = await JSZipMod.loadAsync(templateBuf);
  const sectionFile = inZip.file("Contents/section0.xml");
  if (!sectionFile) throw new Error("템플릿에 section0.xml 없음");

  let xml = await sectionFile.async("string");
  const replacements = buildReplacements(form);
  for (const [oldStr, newStr] of Object.entries(replacements)) {
    xml = xml.split(`<hp:t>${oldStr}</hp:t>`).join(`<hp:t>${newStr}</hp:t>`);
  }

  // 새 zip 빌드 — mimetype 은 STORED 로 첫번째 (hwpx 표준)
  const outZip = new JSZipMod();
  const mimeFile = inZip.file("mimetype");
  if (mimeFile) {
    const mime = await mimeFile.async("uint8array");
    outZip.file("mimetype", mime, { compression: "STORE" });
  }
  // 나머지 파일 — section0.xml 만 치환된 거 사용
  const fileNames = Object.keys(inZip.files).filter((n) => n !== "mimetype");
  for (const name of fileNames) {
    const f = inZip.files[name];
    if (f.dir) continue;
    if (name === "Contents/section0.xml") {
      outZip.file(name, xml);
    } else {
      const buf = await f.async("uint8array");
      outZip.file(name, buf);
    }
  }

  return outZip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

// ─────────────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────────────
export default function WeeklyBulletinPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [deptName, setDeptName] = useState("");
  const [form, setForm] = useState<FormState>(() => ({ ...EMPTY_FORM, date: nextSundayDate() }));
  const [toast, setToast] = useState("");
  const [generating, setGenerating] = useState(false);

  // 인증 + 부서명 로드
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      const { data: deptInfo } = await supabase.rpc("get_department_info", { p_dept_id: deptId });
      if (deptInfo && deptInfo[0]) setDeptName(deptInfo[0].name || "");

      // localStorage 에서 직전 입력 복원
      try {
        const saved = localStorage.getItem(STORAGE_KEY + deptId);
        if (saved) {
          const parsed = JSON.parse(saved);
          setForm({ ...EMPTY_FORM, date: nextSundayDate(), ...parsed });
        }
      } catch {/* ignore */}
    })();
  }, []);

  // 폼 변경마다 localStorage 저장
  useEffect(() => {
    if (!authChecked) return;
    try {
      localStorage.setItem(STORAGE_KEY + deptId, JSON.stringify(form));
    } catch {/* ignore */}
  }, [form, authChecked, deptId]);

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  const handleReset = () => {
    if (!confirm("입력한 내용을 모두 지우고 초기화하시겠습니까?")) return;
    setForm({ ...EMPTY_FORM, date: nextSundayDate() });
    localStorage.removeItem(STORAGE_KEY + deptId);
    showToast("초기화되었습니다");
  };

  const handleDownloadHwpx = async () => {
    if (!form.date) {
      showToast("날짜를 선택해주세요");
      return;
    }
    setGenerating(true);
    try {
      const blob = await generateHwpx(form);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `초등1초원주보_${form.date}.hwpx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("hwpx 다운로드 완료 ✅");
    } catch (e: unknown) {
      showToast("생성 실패: " + (e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  if (!authChecked) return <div style={loadingStyle}>로딩 중...</div>;

  const isSupported = deptName === SUPPORTED_DEPT;
  const issue = calcIssueNumber(form.date);

  return (
    <div style={pageStyle}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap" rel="stylesheet" />

      <div style={headerStyle}>
        <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>📰 주보 만들기</div>
        <div style={{ width: 60 }} />
      </div>

      <div style={containerStyle}>
        {!isSupported && (
          <div style={warnCardStyle}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>🚧</div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>현재 {SUPPORTED_DEPT}만 지원합니다</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              다른 부서는 양식이 달라 추후 별도로 추가될 예정입니다.
            </div>
          </div>
        )}

        {/* ① 기본 정보 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>① 기본 정보</div>
          <FormRow label="발행 일자 (주일)">
            <input
              type="date"
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
              style={inputStyle}
            />
            <div style={hintStyle}>
              일요일을 선택하세요. 호수: <b>{issue ? issue.label : "(일요일 선택 시 자동)"}</b>
            </div>
          </FormRow>
        </div>

        {/* ② 1부 예배 순서 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>② 1부 예배 (인명 / 멘트)</div>

          <FormRow label="안내">
            <input type="text" value={form.guide} onChange={(e) => set("guide", e.target.value)} placeholder="예: 박희연" style={inputStyle} />
          </FormRow>
          <FormRow label="찬양 (2명)">
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" value={form.praise1} onChange={(e) => set("praise1", e.target.value)} placeholder="이름1" style={inputStyle} />
              <input type="text" value={form.praise2} onChange={(e) => set("praise2", e.target.value)} placeholder="이름2" style={inputStyle} />
            </div>
          </FormRow>
          <FormRow label="예배인도 (부장)">
            <input type="text" value={form.leader} onChange={(e) => set("leader", e.target.value)} placeholder="예: 최성헌" style={inputStyle} />
          </FormRow>
          <FormRow label="주제제창 멘트">
            <input type="text" value={form.theme} onChange={(e) => set("theme", e.target.value)} placeholder="예: 하나님의 안경으로 세상을 바라보는 어린이" style={inputStyle} />
          </FormRow>
          <FormRow label="기도 (반)">
            <input type="text" value={form.prayerClass} onChange={(e) => set("prayerClass", e.target.value)} placeholder="예: 2-3" style={inputStyle} />
            <div style={hintStyle}>"반 어린이" 가 자동 붙음 → "2-3반 어린이"</div>
          </FormRow>
          <FormRow label="성경봉독">
            <input type="text" value={form.scripture} onChange={(e) => set("scripture", e.target.value)} placeholder="예: 창세기 11장 1~9절" style={inputStyle} />
          </FormRow>
          <FormRow label="강론 제목">
            <input type="text" value={form.sermonTitle} onChange={(e) => set("sermonTitle", e.target.value)} placeholder="예: 우리는 배울 때 무엇을 조심해야 할까요?" style={inputStyle} />
          </FormRow>
          <FormRow label="강론자">
            <input type="text" value={form.preacher} onChange={(e) => set("preacher", e.target.value)} placeholder="예: 김희숙" style={inputStyle} />
            <div style={hintStyle}>"전도사님" 자동 붙음</div>
          </FormRow>
          <FormRow label="다음 주 기도">
            <input type="text" value={form.nextPrayer} onChange={(e) => set("nextPrayer", e.target.value)} placeholder="예: 3-4반 또는 김정권장로님" style={inputStyle} />
          </FormRow>
        </div>

        {/* ③ 헌금 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>③ 헌금</div>
          <FormRow label="십일조">
            <input type="text" value={form.tithe} onChange={(e) => set("tithe", e.target.value)} placeholder="예: 50,000원" style={inputStyle} />
          </FormRow>
          <FormRow label="감사헌금">
            <input type="text" value={form.thanksgiving} onChange={(e) => set("thanksgiving", e.target.value)} placeholder="예: 30,000원" style={inputStyle} />
          </FormRow>
        </div>

        {/* ④ 공과 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>④ 공과 / 퀴즈</div>
          <FormRow label="공과 회차">
            <input type="text" value={form.lessonNum} onChange={(e) => set("lessonNum", e.target.value)} placeholder="예: 14" style={inputStyle} />
            <div style={hintStyle}>"과 공과 퀴즈" 자동 붙음</div>
          </FormRow>
          <FormRow label="퀴즈 1번 — 문제">
            <textarea value={form.q1} onChange={(e) => set("q1", e.target.value)} placeholder="예: 사람들은 왜 바벨탑을 쌓으려고 했나요?" rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </FormRow>
          <FormRow label="① 보기">
            <input type="text" value={form.q1c1} onChange={(e) => set("q1c1", e.target.value)} placeholder="예: 하나님께 닿으려고, 자기 이름을 높이려고" style={inputStyle} />
          </FormRow>
          <FormRow label="② 보기">
            <input type="text" value={form.q1c2} onChange={(e) => set("q1c2", e.target.value)} style={inputStyle} />
          </FormRow>
          <FormRow label="③ 보기">
            <input type="text" value={form.q1c3} onChange={(e) => set("q1c3", e.target.value)} style={inputStyle} />
          </FormRow>
          <FormRow label="④ 보기">
            <input type="text" value={form.q1c4} onChange={(e) => set("q1c4", e.target.value)} style={inputStyle} />
          </FormRow>
          <FormRow label="퀴즈 2번 — 문제">
            <textarea value={form.q2} onChange={(e) => set("q2", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            <div style={hintStyle}>퀴즈 2번 보기는 현재 템플릿 분석에서 위치 미확인 — 추후 추가</div>
          </FormRow>
        </div>

        {/* ⑤ 새 친구 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>⑤ 새 친구</div>
          <FormRow label="이름">
            <input type="text" value={form.newFriend} onChange={(e) => set("newFriend", e.target.value)} placeholder="예: 차난(1학년)-자진" style={inputStyle} />
          </FormRow>
        </div>

        {/* ⑥ 다운로드 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>⑥ 주보 생성</div>
          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, marginBottom: 12 }}>
            현재 단계 (Phase 1): hwpx 파일 다운로드까지 지원.<br />
            다음 단계 (Phase 2): 사진 4장 업로드 + PDF 자동 생성.<br />
            그 다음 (Phase 3): UMS 게시판 자동 등록 (모바일/데스크톱 분기).
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button onClick={handleReset} style={resetBtnStyle}>초기화</button>
            <button onClick={handleDownloadHwpx} disabled={generating} style={primaryBtnStyle}>
              {generating ? "생성 중..." : "📥 hwpx 다운로드"}
            </button>
          </div>
        </div>
      </div>

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f1f5f9",
  fontFamily: "'Noto Sans KR', sans-serif",
};
const containerStyle: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 14,
};
const headerStyle: React.CSSProperties = {
  background: "#fff",
  borderBottom: "1px solid #e2e8f0",
  padding: "12px 24px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};
const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 14,
  padding: 20,
  boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
};
const warnCardStyle: React.CSSProperties = {
  background: "#fff7ed",
  border: "1.5px solid #fed7aa",
  borderRadius: 14,
  padding: 18,
  textAlign: "center",
  color: "#9a3412",
};
const sectionLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#94a3b8",
  letterSpacing: 0.5,
  marginBottom: 12,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1.5px solid #e2e8f0",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
};
const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#94a3b8",
  marginTop: 4,
};
const backBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#f1f5f9",
  border: "none",
  borderRadius: 8,
  fontSize: 12,
  color: "#475569",
  cursor: "pointer",
  fontFamily: "inherit",
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "10px 22px",
  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 800,
  cursor: "pointer",
  fontFamily: "inherit",
};
const resetBtnStyle: React.CSSProperties = {
  padding: "10px 18px",
  background: "#f1f5f9",
  color: "#475569",
  border: "1.5px solid #e2e8f0",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};
const toastStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 40,
  left: "50%",
  transform: "translateX(-50%)",
  background: "rgba(15,23,42,0.88)",
  color: "#fff",
  padding: "12px 24px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  zIndex: 999,
  fontFamily: "inherit",
  whiteSpace: "nowrap",
  maxWidth: "90vw",
  textAlign: "center",
};
const loadingStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#f1f5f9",
  fontFamily: "'Noto Sans KR', sans-serif",
};
