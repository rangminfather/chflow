"use client";

// 실시간 예배 — YouTube Live 공식 iframe 임베드.
//
// 상태는 /api/live/status 에서 받는다. 그 라우트가 캐시(youtube_live_status)를 읽고,
// 3분 이상 오래됐을 때만 YouTube 를 한 번 조회해 갱신한다(동시요청 선점).
// 화면이 직접 YouTube 를 부르지 않는 이유는 일일 쿼터 때문이다.
//
// 모바일 브라우저는 소리 있는 자동재생을 막으므로 재생은 사용자 탭으로 시작된다.

import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, RefreshCw, Radio, Settings2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { LoadingView } from "@/components/StatusViews";
import { worshipNowLabel, WORSHIP_GUIDE_TEXT } from "@/lib/worshipSchedule";
import SermonArchive from "@/components/SermonArchive";

type WorshipScheduleRow = {
  id: string;
  category: string;
  time_text: string;
  is_live: boolean;
  sort_order: number;
};

type LiveStatus = {
  channel_id: string | null;
  is_live: boolean;
  video_id: string | null;
  title: string | null;
  started_at: string | null;
  checked_at: string | null;
  /** 상태 갱신이 오래 멈춘 상태 — '방송 없음'이라 단정하지 않는다 */
  stale: boolean;
};

const DEFAULT_CHANNEL_ID = "UCGqoK8XTWHLkyU8Nt-as1og"; // 울산명성교회

function channelUrl(channelId: string) {
  return `https://www.youtube.com/channel/${channelId}`;
}

function formatChecked(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export default function LivePage() {
  const router = useRouter();
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const loadInFlightRef = useRef(false);

  async function load(isRefresh = false) {
    if (loadInFlightRef.current || document.visibilityState !== "visible") return;
    loadInFlightRef.current = true;
    if (isRefresh) setRefreshing(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (token) {
        const res = await fetch("/api/live/status", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (res.ok) setStatus((await res.json()) as LiveStatus);
      }
    } catch {
      // 네트워크 실패 시 이전 상태를 유지한다
    } finally {
      loadInFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
        return;
      }
      load();
      supabase.rpc("get_my_status").then(({ data: prof }) => {
        const role = (prof as { role?: string }[] | null)?.[0]?.role;
        setIsStaff(role === "admin" || role === "office");
      });
    });
    // 방송 시작·종료를 화면에 반영하기 위해 1분마다 캐시만 다시 읽는다(YouTube 호출 아님)
    let timer: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const startPolling = () => {
      stopPolling();
      if (document.visibilityState === "visible") {
        timer = setInterval(() => load(), 60_000);
      }
    };
    const loadWhenVisible = () => {
      if (document.visibilityState !== "visible") {
        stopPolling();
        return;
      }
      load();
      startPolling();
    };
    const loadWhenActive = () => {
      if (document.visibilityState === "visible") load();
    };
    startPolling();
    document.addEventListener("visibilitychange", loadWhenVisible);
    window.addEventListener("focus", loadWhenActive);
    window.addEventListener("pageshow", loadWhenActive);
    window.addEventListener("chflow:app-active", loadWhenActive);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", loadWhenVisible);
      window.removeEventListener("focus", loadWhenActive);
      window.removeEventListener("pageshow", loadWhenActive);
      window.removeEventListener("chflow:app-active", loadWhenActive);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <LoadingView />;

  const isLive = !!status?.is_live && !!status?.video_id;
  const chUrl = channelUrl(status?.channel_id || DEFAULT_CHANNEL_ID);

  // 상태 갱신이 멈춘 경우(키 미설정·조회 실패 등)에는 '방송 없음'이라고 단정하지 않는다.
  // 실제로 방송 중인데 없다고 표시하면 안내가 거짓이 된다.
  const stale = !status || status.stale;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", fontFamily: "'Noto Sans KR', sans-serif" }}>
      <header
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 14px",
          background: "var(--card)",
          borderBottom: "1px solid var(--hairline)",
          position: "sticky", top: 0, zIndex: 10,
        }}
      >
        <button
          onClick={() => router.push("/home")}
          aria-label="홈으로"
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "7px 11px", borderRadius: 10,
            border: "1px solid var(--hairline-strong)",
            background: "var(--bg-soft)", color: "var(--ink-mid)",
            fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}
        >
          <ArrowLeft size={16} strokeWidth={1.8} />
          <span>홈</span>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>예배</div>
          <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 1 }}>
            울산명성교회 유튜브
            {status?.checked_at && ` · ${formatChecked(status.checked_at)} 확인`}
          </div>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          aria-label="새로고침"
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 34, height: 34, borderRadius: 10,
            border: "1px solid var(--hairline-strong)",
            background: "var(--bg-soft)", color: "var(--ink-mid)",
            cursor: refreshing ? "default" : "pointer",
          }}
        >
          <RefreshCw size={15} strokeWidth={1.9} />
        </button>
      </header>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: 14 }}>
        {isLive ? (
          <>
            <div
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "5px 11px", borderRadius: 999,
                background: "var(--danger)", color: "var(--paper)",
                fontSize: 11, fontWeight: 800, letterSpacing: 0.4,
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: "var(--paper)", display: "inline-block",
                }}
              />
              LIVE
            </div>
            {/* 지금이 어느 예배인지 (시간표 기준) */}
            <div style={{ marginLeft: 8, display: "inline-block", fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>
              {worshipNowLabel(status?.started_at ? new Date(status.started_at) : new Date())}
            </div>

            <div
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: "16 / 9",
                borderRadius: 12,
                overflow: "hidden",
                background: "var(--ink)",
                border: "1px solid var(--hairline)",
              }}
            >
              <iframe
                src={`https://www.youtube.com/embed/${status!.video_id}?rel=0&playsinline=1&autoplay=1`}
                title={status?.title || "실시간 예배"}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
              />
            </div>

            {status?.title && (
              <div style={{ marginTop: 12, fontSize: 15, fontWeight: 700, color: "var(--ink)", lineHeight: 1.45 }}>
                {status.title}
              </div>
            )}

            <p style={{ marginTop: 10, fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.7 }}>
              소리가 나오지 않으면 화면을 한 번 눌러 재생해 주세요. 휴대폰은 자동재생이 제한됩니다.
            </p>
          </>
        ) : (
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--hairline)",
              borderRadius: 14,
              padding: "34px 20px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 52, height: 52, borderRadius: 15,
                background: "var(--bg-soft)", color: "var(--ink-faint)",
                marginBottom: 14,
              }}
            >
              <Radio size={24} strokeWidth={1.8} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", marginBottom: 6 }}>
              {stale ? "방송 여부를 확인하지 못했습니다" : "지금은 생방송이 없습니다"}
            </div>
            <p style={{ fontSize: 13, color: "var(--ink-mid)", lineHeight: 1.8, margin: "0 auto", maxWidth: 320 }}>
              {stale
                ? "아래 버튼으로 유튜브 채널에서 직접 확인해 주세요. 방송 중이라면 채널에 표시됩니다."
                : "예배가 시작되면 이 화면에서 바로 보실 수 있습니다."}
            </p>
          </div>
        )}

        {/* 예배안내: 방송 여부와 상관없이 항상 표시 — 관리자·사무실은 여기서 톱니바퀴로 추가·수정·삭제 */}
        <WorshipGuideSection isStaff={isStaff} />

        {/* 오프에어에는 유튜브 버튼을 두지 않는다 (지난 말씀은 아래 목록에서 본다) */}
        {(isLive || stale) && (
        <a
          href={isLive ? `https://www.youtube.com/watch?v=${status!.video_id}` : `${chUrl}/streams`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            marginTop: 14, padding: "13px 16px", borderRadius: 12,
            background: "var(--card)", border: "1px solid var(--hairline-strong)",
            color: "var(--ink-mid)", fontSize: 13, fontWeight: 700,
            textDecoration: "none",
          }}
        >
          <ExternalLink size={15} strokeWidth={1.9} />
          {isLive ? "유튜브 앱에서 보기" : "유튜브 채널에서 확인하기"}
        </a>
        )}

        {/* 지난 말씀 듣기 — UMS 설교 게시판 목록 */}
        <SermonArchive />
      </div>
    </div>
  );
}

// ───────────────────────── 예배안내 (전체 예배 시간표) ─────────────────────────
// 한 행 = 예배 한 회차. 같은 category 값끼리 화면에서 한 그룹으로 묶인다.
// "시간 칸에 회차를 여러 개 몰아넣지 않고, 회차마다 행을 하나씩 추가"하는 방식으로
// 회차별 실시간 여부를 독립적으로 관리한다(열을 3,4,5...로 늘리지 않는다).

function WorshipGuideSection({ isStaff }: { isStaff: boolean }) {
  const [rows, setRows] = useState<WorshipScheduleRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [managing, setManaging] = useState(false);
  const [error, setError] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newLive, setNewLive] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase.rpc("list_worship_schedule");
      if (!err && Array.isArray(data)) setRows(data as WorshipScheduleRow[]);
      setLoaded(true);
    })();
  }, []);

  function groupBy(list: WorshipScheduleRow[]) {
    const order: string[] = [];
    const map = new Map<string, WorshipScheduleRow[]>();
    for (const r of list) {
      if (!map.has(r.category)) { map.set(r.category, []); order.push(r.category); }
      map.get(r.category)!.push(r);
    }
    return order.map((category) => ({ category, items: map.get(category)! }));
  }

  const groups = useMemo(() => groupBy(rows), [rows]);

  // 조회 실패·빈 목록이면 기존 안내 문구를 그대로 보여준다(화면이 아예 비는 것 방지)
  const fallbackGroups = useMemo(() => WORSHIP_GUIDE_TEXT.map((g) => ({
    category: g.when,
    items: g.items.map((it, i) => ({
      id: `${g.when}-${i}`,
      category: g.when,
      time_text: [it.label, it.time].filter(Boolean).join(" ") + (it.note ? ` (${it.note})` : ""),
      is_live: !!it.live,
      sort_order: 0,
    })),
  })), []);

  const showGroups = loaded && rows.length > 0 ? groups : fallbackGroups;
  const categoryOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.category))), [rows]);

  function updateLocal(id: string, patch: Partial<WorshipScheduleRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function persist(row: WorshipScheduleRow) {
    if (!row.category.trim() || !row.time_text.trim()) {
      setError("예배종류와 예배시간은 비워둘 수 없습니다");
      return;
    }
    setError("");
    const { error: err } = await supabase.rpc("update_worship_schedule_item", {
      p_id: row.id, p_category: row.category.trim(), p_time_text: row.time_text.trim(), p_is_live: row.is_live,
    });
    if (err) setError(err.message);
  }

  async function toggleLive(row: WorshipScheduleRow) {
    const nextLive = !row.is_live;
    updateLocal(row.id, { is_live: nextLive });
    await persist({ ...row, is_live: nextLive });
  }

  async function removeRow(row: WorshipScheduleRow) {
    if (!confirm(`「${row.category} · ${row.time_text}」 항목을 삭제하시겠습니까?`)) return;
    const { error: err } = await supabase.rpc("delete_worship_schedule_item", { p_id: row.id });
    if (err) { setError(err.message); return; }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  }

  async function addRow() {
    if (!newCategory.trim() || !newTime.trim()) {
      setError("예배종류와 예배시간을 입력하세요");
      return;
    }
    setAdding(true);
    setError("");
    const { data, error: err } = await supabase.rpc("create_worship_schedule_item", {
      p_category: newCategory.trim(), p_time_text: newTime.trim(), p_is_live: newLive,
    });
    setAdding(false);
    if (err) { setError(err.message); return; }
    setRows((prev) => [...prev, {
      id: data as string, category: newCategory.trim(), time_text: newTime.trim(),
      is_live: newLive, sort_order: (prev[prev.length - 1]?.sort_order ?? 0) + 10,
    }]);
    setNewTime("");
    setNewLive(false);
    // 예배종류는 남겨둔다 — 같은 카테고리에 회차를 이어서 추가하기 쉽도록
  }

  return (
    <div style={{ marginTop: 14, padding: "14px 16px", borderRadius: 14, background: "var(--card)", border: "1px solid var(--hairline)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-mid)" }}>예배안내</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--accent)", fontSize: 10.5, fontWeight: 700 }}>
            <Radio size={11} strokeWidth={2} /> 실시간 중계
          </span>
          {isStaff && (
            <button
              type="button"
              onClick={() => setManaging((v) => !v)}
              aria-pressed={managing}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "4px 9px", borderRadius: 8, border: "none", cursor: "pointer",
                fontFamily: "inherit", fontSize: 11, fontWeight: 700,
                background: managing ? "var(--accent-soft)" : "var(--bg-soft)",
                color: managing ? "var(--accent)" : "var(--ink-mid)",
              }}
            >
              <Settings2 size={13} strokeWidth={2} /> 관리
            </button>
          )}
        </div>
      </div>

      {!managing && (
        <div style={{ fontSize: 11.5, color: "var(--ink-soft)", lineHeight: 1.6, marginBottom: 4 }}>
          실시간 표시가 있는 예배는 생방송으로 시청할 수 있습니다.
        </div>
      )}

      {error && (
        <div style={{ margin: "6px 0", padding: "8px 10px", borderRadius: 8, background: "color-mix(in srgb, var(--danger) 10%, transparent)", color: "var(--danger)", fontSize: 12, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {managing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.6 }}>
            같은 예배종류를 여러 번 입력하면(예: &ldquo;주일예배&rdquo;) 화면에서 한 그룹으로 묶여 표시됩니다.
            회차(1부·2부...)마다 실시간 여부를 따로 체크하려면, 시간 칸에 여러 회차를 함께 적지 말고
            회차마다 행을 하나씩 추가해 주세요.
          </div>

          <datalist id="worship-category-options">
            {categoryOptions.map((c) => <option key={c} value={c} />)}
          </datalist>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((row) => (
              <div key={row.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "8px 9px", borderRadius: 9, background: "var(--bg-soft)" }}>
                <input
                  list="worship-category-options"
                  value={row.category}
                  onChange={(e) => updateLocal(row.id, { category: e.target.value })}
                  onBlur={() => { const r = rows.find((x) => x.id === row.id); if (r) persist(r); }}
                  placeholder="예배종류"
                  style={{ ...guideInputStyle, flex: "1 1 100px" }}
                />
                <input
                  value={row.time_text}
                  onChange={(e) => updateLocal(row.id, { time_text: e.target.value })}
                  onBlur={() => { const r = rows.find((x) => x.id === row.id); if (r) persist(r); }}
                  placeholder="예배시간"
                  style={{ ...guideInputStyle, flex: "1 1 140px" }}
                />
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "var(--ink-mid)", flexShrink: 0 }}>
                  <input type="checkbox" checked={row.is_live} onChange={() => toggleLive(row)} />
                  실시간
                </label>
                <button
                  type="button"
                  onClick={() => removeRow(row)}
                  aria-label="삭제"
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 28, height: 28, borderRadius: 7, border: "none", flexShrink: 0,
                    background: "color-mix(in srgb, var(--danger) 10%, transparent)",
                    color: "var(--danger)", cursor: "pointer",
                  }}
                >
                  <Trash2 size={13} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "9px 9px", borderRadius: 9, border: "1px dashed var(--accent)", background: "var(--accent-soft)" }}>
            <input
              list="worship-category-options"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="예배종류 (예: 주일예배)"
              style={{ ...guideInputStyle, flex: "1 1 100px" }}
            />
            <input
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              placeholder="예배시간 (예: 2부 오전 9:00)"
              style={{ ...guideInputStyle, flex: "1 1 140px" }}
            />
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "var(--ink-mid)", flexShrink: 0 }}>
              <input type="checkbox" checked={newLive} onChange={(e) => setNewLive(e.target.checked)} />
              실시간
            </label>
            <button
              type="button"
              onClick={addRow}
              disabled={adding}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "6px 11px", borderRadius: 7, border: "none", cursor: adding ? "default" : "pointer",
                background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 12, flexShrink: 0,
                fontFamily: "inherit", opacity: adding ? 0.6 : 1,
              }}
            >
              <Plus size={13} strokeWidth={2} /> 추가
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left" }}>
          {showGroups.map((g) => (
            <div key={g.category} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12, color: "var(--ink-mid)", lineHeight: 1.7 }}>
              <span style={{ width: 58, flexShrink: 0, fontWeight: 700, color: "var(--ink)" }}>{g.category}</span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: "3px 8px", flex: 1, minWidth: 0 }}>
                {g.items.map((item) => (
                  <span key={item.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                    <span>{item.time_text}</span>
                    {item.is_live && (
                      <span style={{ display: "inline-flex", alignItems: "center", padding: "1px 4px", borderRadius: 4, background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)", fontSize: 9.5, fontWeight: 800, lineHeight: 1.3 }}>
                        실시간
                      </span>
                    )}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const guideInputStyle: React.CSSProperties = {
  minWidth: 0, height: 32, padding: "0 8px", borderRadius: 7,
  border: "1px solid var(--hairline-strong)", background: "var(--card)",
  color: "var(--ink)", fontFamily: "inherit", fontSize: 12.5,
};
