"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

// 매주 변하는 핵심 필드만. (강론자처럼 거의 고정인 항목은 별도 설정으로 관리 예정.)
const EMPTY_FORM = {
  date: nextSundayDate(),
  topic: "",          // 주제
  scripture: "",      // 성경본문
  leader: "",         // 예배인도
  praise: "",         // 찬양 (선곡)
  prayer: "",         // 기도 (반별)
  scripture_reader: "", // 성경봉독 (담당 학생)
  sermon_title: "",   // 설교제목
  preacher: "",       // 강론자 (고정에 가깝지만 변경 여지 있음)
  announcement: "",   // 광고/공지
};

type FormState = typeof EMPTY_FORM;

const SUPPORTED_DEPT = "초등1부";

interface CooldownStatus {
  remaining_seconds: number;
  can_post: boolean;
  last_posted_at: string | null;
  last_post_no: number | null;
  last_subject: string | null;
  ums_user_id: string;
}

export default function WeeklyBulletinPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [deptName, setDeptName] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [toast, setToast] = useState("");
  const [cooldown, setCooldown] = useState<CooldownStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [registering, setRegistering] = useState(false);
  const [registerResult, setRegisterResult] = useState<
    | { ok: true; post_no: number; post_url: string; subject: string }
    | { ok: false; error: string }
    | null
  >(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      const { data: deptInfo } = await supabase.rpc("get_department_info", { p_dept_id: deptId });
      if (deptInfo && deptInfo[0]) setDeptName(deptInfo[0].name || "");
      await fetchStatus();
    })();
  }, []);

  // 쿨다운이 0보다 크면 1초마다 클라이언트에서 감산. 0 되면 멈춤.
  useEffect(() => {
    if (!cooldown || cooldown.remaining_seconds <= 0) return;
    const t = setInterval(() => {
      setCooldown((c) => {
        if (!c) return c;
        const next = Math.max(0, c.remaining_seconds - 1);
        return { ...c, remaining_seconds: next, can_post: next === 0 };
      });
    }, 1000);
    return () => clearInterval(t);
  }, [cooldown?.remaining_seconds === 0 ? 0 : 1]);

  async function fetchStatus() {
    try {
      const r = await fetch("/api/ums-bulletin-post/status", { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) {
        setStatusError(j.error || "상태 조회 실패");
        return;
      }
      setStatusError("");
      setCooldown({
        remaining_seconds: j.remaining_seconds || 0,
        can_post: j.can_post,
        last_posted_at: j.last_posted_at,
        last_post_no: j.last_post_no,
        last_subject: j.last_subject,
        ums_user_id: j.ums_user_id,
      });
    } catch (e: unknown) {
      setStatusError((e as Error).message || "네트워크 오류");
    }
  }

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  const handleReset = () => {
    if (!confirm("입력한 내용을 모두 지우고 초기화하시겠습니까?")) return;
    setForm({ ...EMPTY_FORM, date: nextSundayDate() });
    showToast("초기화되었습니다");
  };

  const handleRegister = async () => {
    if (cooldown && !cooldown.can_post) {
      showToast(`아직 ${formatRemaining(cooldown.remaining_seconds)} 남았습니다`);
      return;
    }
    if (!form.topic.trim() || !form.scripture.trim()) {
      showToast("주제와 성경본문은 필수입니다");
      return;
    }
    if (!confirm(
      "주보를 PDF로 생성하고 명성교회 사무실 게시판에 자동 등록합니다.\n진행하시겠습니까?\n\n※ 이번 등록 후 30분간 재등록 불가",
    )) return;

    setRegistering(true);
    setRegisterResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/ums-bulletin-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dept_name: deptName,
          dept_id: deptId,
          chflow_user_id: session?.user?.id,
          ...form,
        }),
      });
      const j = await r.json();
      if (j.ok) {
        setRegisterResult({ ok: true, post_no: j.post_no, post_url: j.post_url, subject: j.subject });
        await fetchStatus();  // 쿨다운 다시 받아오기
      } else {
        setRegisterResult({ ok: false, error: j.error || "알 수 없는 오류" });
      }
    } catch (e: unknown) {
      setRegisterResult({ ok: false, error: (e as Error).message || "네트워크 오류" });
    } finally {
      setRegistering(false);
    }
  };

  if (!authChecked) return <div style={loadingStyle}>로딩 중...</div>;

  const isSupported = deptName === SUPPORTED_DEPT;

  return (
    <div style={pageStyle}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap" rel="stylesheet" />

      {/* Header */}
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
            <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>
              다른 부서는 주보 양식이 달라 추후 별도로 추가될 예정입니다.<br />
              아래 폼은 미리보기 용도로 입력 가능합니다.
            </div>
          </div>
        )}

        {/* 1) 기본 정보 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>① 기본 정보</div>
          <FormRow label="발행 일자 (주일)">
            <input
              type="date"
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
              style={inputStyle}
            />
          </FormRow>
        </div>

        {/* 2) 주일예배 순서 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>② 주일예배 순서</div>

          <FormRow label="주제">
            <input
              type="text"
              value={form.topic}
              onChange={(e) => set("topic", e.target.value)}
              placeholder="예: 하나님의 안경으로 세상을 바라보는 어린이!"
              style={inputStyle}
            />
          </FormRow>

          <FormRow label="성경본문">
            <input
              type="text"
              value={form.scripture}
              onChange={(e) => set("scripture", e.target.value)}
              placeholder="예: 히 11:3"
              style={inputStyle}
            />
          </FormRow>

          <FormRow label="예배인도">
            <input
              type="text"
              value={form.leader}
              onChange={(e) => set("leader", e.target.value)}
              placeholder="인도자 이름"
              style={inputStyle}
            />
          </FormRow>

          <FormRow label="찬양 (선곡)">
            <input
              type="text"
              value={form.praise}
              onChange={(e) => set("praise", e.target.value)}
              placeholder="예: 주님의 사랑"
              style={inputStyle}
            />
          </FormRow>

          <FormRow label="기도 담당">
            <input
              type="text"
              value={form.prayer}
              onChange={(e) => set("prayer", e.target.value)}
              placeholder="예: 2-3반"
              style={inputStyle}
            />
          </FormRow>

          <FormRow label="성경봉독 (학생)">
            <input
              type="text"
              value={form.scripture_reader}
              onChange={(e) => set("scripture_reader", e.target.value)}
              placeholder="봉독 학생 이름"
              style={inputStyle}
            />
          </FormRow>

          <FormRow label="설교제목">
            <input
              type="text"
              value={form.sermon_title}
              onChange={(e) => set("sermon_title", e.target.value)}
              placeholder="강론 제목"
              style={inputStyle}
            />
          </FormRow>

          <FormRow label="강론자">
            <input
              type="text"
              value={form.preacher}
              onChange={(e) => set("preacher", e.target.value)}
              placeholder="예: 심주석 전도사"
              style={inputStyle}
            />
          </FormRow>
        </div>

        {/* 3) 광고/공지 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>③ 광고 / 공지사항</div>
          <FormRow label="이번 주 광고">
            <textarea
              value={form.announcement}
              onChange={(e) => set("announcement", e.target.value)}
              placeholder={"한 줄에 하나씩 입력하세요.\n예:\n- 다음 주 부활절 분반활동\n- 5/3 야외예배 안내"}
              rows={6}
              style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
            />
          </FormRow>
        </div>

        {/* 4) 액션 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>④ 등록</div>

          {statusError && (
            <div style={{ ...alertBoxStyle, background: "#fef2f2", borderColor: "#fecaca", color: "#b91c1c" }}>
              ⚠️ 상태 조회 실패: {statusError}
            </div>
          )}

          {cooldown && cooldown.last_posted_at && (
            <div style={alertBoxStyle}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>
                직전 등록 ({cooldown.ums_user_id})
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>
                #{cooldown.last_post_no} · {formatLastPostedAt(cooldown.last_posted_at)}
              </div>
              {cooldown.last_subject && (
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                  {cooldown.last_subject}
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, marginBottom: 12 }}>
            등록 버튼을 누르면 입력한 내용으로 PDF가 생성되고, 명성교회 사무실 게시판에 자동 업로드됩니다.
            <br />
            <span style={{ color: "#b45309", fontWeight: 700 }}>※ 같은 UMS 계정은 30분에 한 번만 등록 가능합니다.</span>
          </div>

          {cooldown && !cooldown.can_post && (
            <div style={cooldownBoxStyle}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e", marginBottom: 4 }}>
                ⏱ 다음 등록까지
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#92400e", fontFamily: "monospace", letterSpacing: 1 }}>
                {formatRemaining(cooldown.remaining_seconds)}
              </div>
              <div style={{ fontSize: 11, color: "#a16207", marginTop: 4 }}>
                30분 안에 같은 계정으로 또 올리면 UMS 서버가 차단합니다.
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button onClick={handleReset} style={resetBtnStyle}>초기화</button>
            <button
              onClick={handleRegister}
              disabled={!cooldown?.can_post}
              style={cooldown?.can_post ? registerBtnStyle : registerBtnDisabledStyle}
            >
              📤 등록
            </button>
          </div>
        </div>
      </div>

      {/* 등록 진행 / 결과 모달 */}
      {(registering || registerResult) && (
        <div style={modalBackdropStyle}>
          <div style={modalCardStyle}>
            {registering && (
              <>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📤</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#1e293b", marginBottom: 6 }}>
                  주보를 등록하고 있어요...
                </div>
                <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
                  PDF 생성 → UMS 로그인 → 파일 업로드 → 글 등록<br />
                  최대 30초 소요됩니다.
                </div>
              </>
            )}
            {registerResult && registerResult.ok && (
              <>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#15803d", marginBottom: 6 }}>
                  등록 완료
                </div>
                <div style={{ fontSize: 12, color: "#1e293b", marginBottom: 4 }}>
                  글번호 #{registerResult.post_no}
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14, wordBreak: "break-all" }}>
                  {registerResult.subject}
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <a
                    href={registerResult.post_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ ...modalSecondaryBtnStyle, textDecoration: "none" }}
                  >
                    UMS 게시판 보기
                  </a>
                  <button onClick={() => setRegisterResult(null)} style={modalPrimaryBtnStyle}>
                    확인
                  </button>
                </div>
              </>
            )}
            {registerResult && !registerResult.ok && (
              <>
                <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#b91c1c", marginBottom: 6 }}>
                  등록 실패
                </div>
                <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, marginBottom: 14, wordBreak: "break-word" }}>
                  {registerResult.error}
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => setRegisterResult(null)} style={modalPrimaryBtnStyle}>
                    닫기
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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

// 다음 주일(일요일) 날짜를 YYYY-MM-DD 로 반환. 오늘이 일요일이면 오늘.
function nextSundayDate(): string {
  const d = new Date();
  const day = d.getDay(); // 0=일
  const diff = day === 0 ? 0 : 7 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatLastPostedAt(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}시간 전`;
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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

const registerBtnStyle: React.CSSProperties = {
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

const registerBtnDisabledStyle: React.CSSProperties = {
  ...{
    padding: "10px 22px",
    background: "#e2e8f0",
    color: "#94a3b8",
    border: "none",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 800,
    cursor: "not-allowed",
    fontFamily: "inherit",
  },
};

const alertBoxStyle: React.CSSProperties = {
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: "10px 14px",
  marginBottom: 10,
};

const cooldownBoxStyle: React.CSSProperties = {
  background: "#fef3c7",
  border: "1.5px solid #fbbf24",
  borderRadius: 12,
  padding: "12px 14px",
  marginBottom: 14,
  textAlign: "center",
};

const modalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  zIndex: 1000,
};

const modalCardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  padding: "22px 22px 18px",
  width: "100%",
  maxWidth: 380,
  boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
  textAlign: "center",
};

const modalPrimaryBtnStyle: React.CSSProperties = {
  padding: "8px 18px",
  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const modalSecondaryBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#f1f5f9",
  color: "#475569",
  border: "1.5px solid #e2e8f0",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  display: "inline-block",
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
