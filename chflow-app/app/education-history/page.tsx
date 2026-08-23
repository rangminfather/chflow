"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileUp, GraduationCap, Search, ShieldAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  canImportEducationHistory,
  canManageEducationCourses,
  canManageEducationHistory,
} from "@/lib/education/permissions";
import YmdSelect from "@/components/YmdSelect";

const TABS = [
  "성도별 이력", "과정별 조회", "기본필수과정 현황", "LMTC",
  "통계", "자료 가져오기", "매칭·검수", "과정 관리",
] as const;
type Tab = typeof TABS[number];
type JsonRecord = Record<string, unknown>;

/** 과정 정책 적용 기간에서 고를 수 있는 연도 범위 */
const POLICY_MIN_YEAR = new Date().getFullYear() - 15;
const POLICY_MAX_YEAR = new Date().getFullYear() + 5;

interface MemberSummary {
  member_id: string;
  member_name: string;
  sub_role: string | null;
  total_history_count: number;
  life_study_count: number;
  required_completed_count: number;
  required_total_count: number;
  latest_completed_on: string | null;
  required_status: string;
}

function array(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item): item is JsonRecord => !!item && typeof item === "object") : [];
}
function text(value: unknown): string {
  return value == null ? "" : String(value);
}
function number(value: unknown): number {
  return Number(value ?? 0);
}
function statusLabel(value: unknown): string {
  return ({
    completed: "수료", attended: "이수", education: "교육", applied: "신청",
    incomplete: "미이수", unknown: "미기재",
  } as Record<string, string>)[text(value)] ?? text(value);
}

export default function EducationHistoryPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("성도별 이력");
  const [caps, setCaps] = useState<string[]>([]);
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [memberDetail, setMemberDetail] = useState<JsonRecord | null>(null);
  const [courseData, setCourseData] = useState<JsonRecord>({});
  const [requiredData, setRequiredData] = useState<JsonRecord>({});
  const [lmtcData, setLmtcData] = useState<JsonRecord>({});
  const [stats, setStats] = useState<JsonRecord>({});
  const [batches, setBatches] = useState<JsonRecord[]>([]);
  const [courses, setCourses] = useState<JsonRecord[]>([]);
  const [courseAliases, setCourseAliases] = useState<JsonRecord[]>([]);
  const [coursePolicies, setCoursePolicies] = useState<JsonRecord[]>([]);
  const [unclassifiedRows, setUnclassifiedRows] = useState<JsonRecord[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canManage = canManageEducationHistory(caps);
  const canImport = canImportEducationHistory(caps);
  const canCourseManage = canManageEducationCourses(caps);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      router.replace("/");
      return;
    }
    const { data: capabilityData, error: capError } = await supabase.rpc("get_my_app_capabilities");
    if (capError) {
      setError(capError.message);
      setLoading(false);
      return;
    }
    const nextCaps = Array.isArray(capabilityData) ? capabilityData.map(String) : [];
    setCaps(nextCaps);
    const isManager = nextCaps.includes("education_history.manage");
    const [memberResult, courseResult, requiredResult, lmtcResult, statsResult] = await Promise.all([
      supabase.rpc("education_member_summaries", { p_limit: 100, p_offset: 0 }),
      supabase.rpc("education_course_dashboard"),
      supabase.rpc("education_required_dashboard"),
      supabase.rpc("education_lmtc_dashboard"),
      supabase.rpc("education_statistics"),
    ]);
    const firstError = [memberResult, courseResult, requiredResult, lmtcResult, statsResult].find((item) => item.error)?.error;
    if (firstError) setError(firstError.message);
    setMembers((memberResult.data ?? []) as MemberSummary[]);
    setCourseData((courseResult.data ?? {}) as JsonRecord);
    setRequiredData((requiredResult.data ?? {}) as JsonRecord);
    setLmtcData((lmtcResult.data ?? {}) as JsonRecord);
    setStats((statsResult.data ?? {}) as JsonRecord);
    if (isManager) {
      const [batchResult, courseMasterResult, aliasResult, policyResult, unclassifiedResult] = await Promise.all([
        supabase.from("education_import_batches").select("*").order("uploaded_at", { ascending: false }).limit(100),
        supabase.from("education_courses").select("*").is("deleted_at", null).order("sort_order"),
        supabase.from("education_course_aliases").select("*").eq("active", true).order("created_at", { ascending: false }),
        supabase.from("education_course_policies").select("*").eq("active", true).order("created_at", { ascending: false }),
        supabase.from("education_import_rows")
          .select("id,course_name_raw,raw_row_text,person_name_normalized,person_name_raw,completed_on,started_on,date_raw,cohort_label_raw,cohort_no")
          .is("suggested_course_id", null).is("excluded_at", null).limit(1000),
      ]);
      setBatches((batchResult.data ?? []) as JsonRecord[]);
      setCourses((courseMasterResult.data ?? []) as JsonRecord[]);
      setCourseAliases((aliasResult.data ?? []) as JsonRecord[]);
      setCoursePolicies((policyResult.data ?? []) as JsonRecord[]);
      setUnclassifiedRows((unclassifiedResult.data ?? []) as JsonRecord[]);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const filteredMembers = useMemo(() =>
    members.filter((item) => item.member_name.includes(query.trim())), [members, query]);

  async function openMember(memberId: string) {
    const { data, error: detailError } = await supabase.rpc("education_member_detail", { p_member_id: memberId });
    if (detailError) setError(detailError.message);
    else setMemberDetail((data ?? {}) as JsonRecord);
  }

  if (loading) return <main className="min-h-screen bg-[var(--background)] p-6 text-center">교육이력을 불러오는 중입니다…</main>;

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-20 border-b border-[var(--hairline)] bg-[var(--card)]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <button onClick={() => router.push("/home")} aria-label="홈으로"><ArrowLeft size={20} /></button>
          <GraduationCap className="text-[var(--accent)]" />
          <div><h1 className="text-lg font-black">삶공부·교육이력</h1><p className="text-xs opacity-60">승인된 공개 이력만 전 성도에게 표시됩니다.</p></div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl p-4">
        {error && <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <nav className="mb-5 flex gap-2 overflow-x-auto pb-2">
          {TABS.map((item) => <button key={item} onClick={() => setTab(item)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${tab === item ? "bg-[var(--accent)] text-white" : "bg-[var(--card)]"}`}>{item}</button>)}
        </nav>

        {tab === "성도별 이력" && <MemberTab members={filteredMembers} query={query} setQuery={setQuery} detail={memberDetail} openMember={openMember} closeDetail={() => setMemberDetail(null)} />}
        {tab === "과정별 조회" && <CourseTab data={courseData} />}
        {tab === "기본필수과정 현황" && <RequiredTab data={requiredData} />}
        {tab === "LMTC" && <LmtcTab data={lmtcData} canManage={canManage} />}
        {tab === "통계" && <StatsTab data={stats} />}
        {tab === "자료 가져오기" && (canImport ? <ImportTab batches={batches} reload={reload} /> : <Denied />)}
        {tab === "매칭·검수" && (canManage ? <ReviewTab courses={courses} batches={batches} reloadDashboard={reload} /> : <Denied />)}
        {tab === "과정 관리" && (canCourseManage ? <CourseManageTab courses={courses} aliases={courseAliases} policies={coursePolicies} unclassifiedRows={unclassifiedRows} reload={reload} /> : <Denied />)}
      </div>
    </main>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-4 shadow-sm">{children}</section>;
}
function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-bold text-[var(--accent)]">{children}</span>;
}
function Denied() {
  return <Panel><div className="flex items-center gap-2"><ShieldAlert /> 이 화면은 교육이력 수정 권한이 필요합니다.</div></Panel>;
}

function MemberTab({ members, query, setQuery, detail, openMember, closeDetail }: {
  members: MemberSummary[]; query: string; setQuery: (value: string) => void;
  detail: JsonRecord | null; openMember: (id: string) => void; closeDetail: () => void;
}) {
  if (detail) {
    const member = (detail.member ?? {}) as JsonRecord;
    const summary = (detail.summary ?? {}) as JsonRecord;
    const requirements = array(detail.requirements);
    const histories = array(detail.histories);
    return <div className="space-y-4">
      <button onClick={closeDetail} className="text-sm font-bold">← 성도 목록</button>
      <Panel><h2 className="text-xl font-black">{text(member.name)}</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="전체 이력" value={number(summary.total_history_count)} />
          <Metric label="삶공부" value={number(summary.life_study_count)} />
          <Metric label="기본필수 충족" value={`${number(summary.required_completed_count)}/${number(summary.required_total_count)}`} />
          <Metric label="최근 수료일" value={text(summary.latest_completed_on) || "-"} />
        </div>
      </Panel>
      <div className="grid gap-3 md:grid-cols-5">{requirements.map((item) => <Panel key={text(item.course_id)}><div className="font-bold">{text(item.course_name)}</div><div className="mt-2"><Badge>{text(item.status)}</Badge></div></Panel>)}</div>
      <Panel><h3 className="mb-3 font-black">교육 이력</h3><Table headers={["과정명","분류","기수","반","강사","상태","수료일/기간"]} rows={histories.map((row) => [
        text(row.course_name), text(row.category), text(row.cohort_label_raw || row.cohort_no),
        text(row.class_variant), text(row.instructor_raw), statusLabel(row.attendance_status),
        text(row.completed_on || `${text(row.started_on)} ~ ${text(row.ended_on)}`),
      ])} /></Panel>
    </div>;
  }
  return <div className="space-y-4"><Panel><div className="flex items-center gap-2"><Search size={18} /><input className="w-full bg-transparent outline-none" placeholder="성도 이름 검색" value={query} onChange={(event) => setQuery(event.target.value)} /></div></Panel>
    <Panel><Table headers={["이름","전체","삶공부","기본필수","최근 수료일","상태"]} rows={members.map((item) => [
      <button key={item.member_id} className="font-bold text-[var(--accent)]" onClick={() => openMember(item.member_id)}>{item.member_name}</button>,
      item.total_history_count, item.life_study_count, `${item.required_completed_count}/${item.required_total_count}`,
      item.latest_completed_on ?? "-", item.required_status,
    ])} /></Panel></div>;
}

function CourseTab({ data }: { data: JsonRecord }) {
  const rows = array(data.courses);
  return <Panel><h2 className="mb-3 text-lg font-black">과정·기수별 이수자</h2><Table headers={["과정","분류","기수","대상","강사","수료","이수"]} rows={rows.map((row) => [
    text(row.course_name), text(row.category), text(row.cohort_label_raw || row.cohort_no), text(row.audience),
    text(row.instructor_raw), number(row.completed_count), number(row.attended_count),
  ])} /></Panel>;
}

function RequiredTab({ data }: { data: JsonRecord }) {
  const summary = (data.summary ?? {}) as JsonRecord;
  const courses = array(data.required_courses);
  const members = array(data.members);
  return <div className="space-y-4">
    <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">현재 정책 기준으로 계산하며, 목자·목녀 자격을 자동 확정하지 않습니다.</div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label="전체 성도" value={number(summary.total_members)} /><Metric label="전체 충족" value={number(summary.fully_met)} /><Metric label="4과목" value={number(summary.four_completed)} /><Metric label="3과목 이하" value={number(summary.three_or_less)} /></div>
    <Panel><Table headers={["이름", ...courses.map((course) => text(course.name)), "충족 수", "최종 상태"]} rows={members.map((member) => {
      const state = (member.courses ?? {}) as JsonRecord;
      return [text(member.member_name), ...courses.map((course) => state[text(course.name)] ? "✓" : "—"), `${number(member.completed_count)}/${number(member.required_count)}`, text(member.status)];
    })} /></Panel>
  </div>;
}

function LmtcTab({ data, canManage }: { data: JsonRecord; canManage: boolean }) {
  const rows = array(data.rows);
  return <Panel><h2 className="mb-3 text-lg font-black">LMTC 기수별 현황</h2><Table headers={["기수","이름","당시 직분","소속","수료일","상태", ...(canManage ? ["증서번호"] : [])]} rows={rows.map((row) => [
    text(row.cohort_label_raw || row.cohort_no), text(row.member_name), text(row.historical_role_raw),
    text(row.organization_raw), text(row.completed_on), statusLabel(row.attendance_status),
    ...(canManage ? [text(row.certificate_no_raw)] : []),
  ])} /></Panel>;
}

function StatsTab({ data }: { data: JsonRecord }) {
  return <div className="space-y-4"><div className="grid grid-cols-2 gap-3 md:grid-cols-6">
    <Metric label="전체 이력" value={number(data.total_histories)} /><Metric label="매칭 완료" value={number(data.matched_rows)} />
    <Metric label="미매칭" value={number(data.unmatched_rows)} /><Metric label="동명이인" value={number(data.ambiguous_rows)} />
    <Metric label="과정 미분류" value={number(data.unclassified_rows)} /><Metric label="날짜 확인" value={number(data.date_error_rows)} />
  </div><Panel><h3 className="mb-3 font-black">과정별 인원</h3><Table headers={["과정","인원"]} rows={array(data.by_course).map((row) => [text(row.course_name), number(row.count)])} /></Panel></div>;
}

function ImportTab({ batches, reload }: { batches: JsonRecord[]; reload: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState("general");
  const [message, setMessage] = useState("");
  async function upload() {
    if (!file) return;
    const { data } = await supabase.auth.getSession();
    const form = new FormData();
    form.set("file", file); form.set("type", type);
    const response = await fetch("/api/education-history/import", { method: "POST", headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` }, body: form });
    const result = await response.json() as JsonRecord;
    setMessage(response.ok ? `임시 배치 ${text(result.batchId)} 생성 완료` : text(result.error));
    if (response.ok) await reload();
  }
  return <div className="space-y-4"><Panel><h2 className="mb-3 font-black">HWPX 원본 임시 가져오기</h2><p className="mb-3 text-sm opacity-70">원본은 공개 Storage에 저장하지 않으며, 추출 행은 승인 전 검수 테이블에만 적재됩니다.</p>
    <div className="flex flex-wrap gap-2"><select value={type} onChange={(event) => setType(event.target.value)} className="rounded-lg border p-2"><option value="general">전체 수료자명부</option><option value="lmtc">LMTC</option></select><input type="file" accept=".hwpx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><button onClick={upload} className="rounded-lg bg-[var(--accent)] px-4 py-2 font-bold text-white"><FileUp className="mr-1 inline" size={16} />임시 적재</button></div>{message && <p className="mt-3 text-sm">{message}</p>}</Panel>
    <Panel><Table headers={["파일명","유형","업로드일","추출 행","유효","상태"]} rows={batches.map((row) => [text(row.source_filename), text(row.source_type), text(row.uploaded_at), number(row.total_rows), number(row.valid_rows), text(row.import_status)])} /></Panel></div>;
}

const REVIEW_FILTERS = [
  ["all", "전체"], ["recommended", "추천 매칭"], ["ambiguous", "동명이인"],
  ["unmatched", "미등록"], ["unclassified", "과정 미분류"], ["date_error", "날짜 확인"],
  ["duplicate", "중복 의심"], ["applied", "신청자"], ["approved", "승인 완료"], ["excluded", "제외"],
] as const;

function ReviewTab({ courses, batches, reloadDashboard }: {
  courses: JsonRecord[]; batches: JsonRecord[]; reloadDashboard: () => Promise<void>;
}) {
  const [rows, setRows] = useState<JsonRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<JsonRecord>({});
  const [filter, setFilter] = useState("all");
  const [batchId, setBatchId] = useState("");
  const [queryInput, setQueryInput] = useState("");
  const [reviewQuery, setReviewQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loadingRows, setLoadingRows] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [memberCandidates, setMemberCandidates] = useState<JsonRecord[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Record<string, string>>({});
  const [selectedCourses, setSelectedCourses] = useState<Record<string, string>>({});
  const limit = 50;

  const loadRows = useCallback(async () => {
    setLoadingRows(true);
    const { data } = await supabase.auth.getSession();
    const params = new URLSearchParams({ filter, page: String(page), limit: String(limit) });
    if (batchId) params.set("batchId", batchId);
    if (reviewQuery) params.set("query", reviewQuery);
    const response = await fetch(`/api/education-history/review?${params}`, {
      headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
      cache: "no-store",
    });
    const result = await response.json() as JsonRecord;
    if (!response.ok) alert(text(result.error));
    else {
      setRows(array(result.items));
      setTotal(number(result.total));
      setCounts((result.counts ?? {}) as JsonRecord);
      setSelected(new Set());
    }
    setLoadingRows(false);
  }, [batchId, filter, page, reviewQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadRows(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRows]);

  async function searchMembers() {
    const { data, error } = await supabase.rpc("education_search_member_candidates", { p_query: memberSearch, p_limit: 30 });
    if (error) alert(error.message); else setMemberCandidates(array(data));
  }

  async function mutate(body: JsonRecord): Promise<boolean> {
    const { data } = await supabase.auth.getSession();
    const response = await fetch("/api/education-history/review", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
      body: JSON.stringify(body),
    });
    const result = await response.json() as JsonRecord;
    if (!response.ok) { alert(text(result.error)); return false; }
    if (result.failed) alert(`${text(result.succeeded)}건 성공, ${text(result.failed)}건 실패`);
    return true;
  }

  async function action(row: JsonRecord, value: string) {
    const ok = await mutate({
      rowId: row.id,
      memberId: selectedMembers[text(row.id)] || row.suggested_member_id,
      courseId: selectedCourses[text(row.id)] || row.suggested_course_id,
      action: value,
      reviewNote: reviewNote || null,
      saveAlias: Boolean(selectedMembers[text(row.id)]),
    });
    if (ok) { await loadRows(); await reloadDashboard(); }
  }

  async function bulkAction(value: "approve" | "exclude" | "unapprove") {
    if (!selected.size || !window.confirm(`선택한 ${selected.size}건을 처리할까요?`)) return;
    const ok = await mutate({ rowIds: [...selected], action: value, reviewNote: reviewNote || null });
    if (ok) { await loadRows(); await reloadDashboard(); }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const pageCount = Math.max(Math.ceil(total / limit), 1);
  return <div className="space-y-4">
    <Panel>
      <div className="flex flex-wrap gap-2">
        {REVIEW_FILTERS.map(([value, label]) => <button key={value} onClick={() => { setFilter(value); setPage(1); }} className={`rounded-full px-3 py-1.5 text-xs font-bold ${filter === value ? "bg-[var(--accent)] text-white" : "bg-[var(--accent-soft)]"}`}>{label} {number(counts[value])}</button>)}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <select className="rounded-lg border p-2 text-sm" value={batchId} onChange={(event) => { setBatchId(event.target.value); setPage(1); }}><option value="">전체 배치</option>{batches.map((batch) => <option key={text(batch.id)} value={text(batch.id)}>{text(batch.source_type)} · {text(batch.source_filename)}</option>)}</select>
        <input className="rounded-lg border p-2 text-sm" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setReviewQuery(queryInput); setPage(1); } }} placeholder="이름 또는 과정 검색" />
        <button className="rounded-lg bg-[var(--accent)] px-4 text-sm text-white" onClick={() => { setReviewQuery(queryInput); setPage(1); }}>검색</button>
      </div>
    </Panel>
    <Panel>
      <div className="flex flex-wrap items-center gap-2">
        <input className="rounded-lg border p-2 text-sm" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="수동 연결 성도 검색" />
        <button className="rounded-lg bg-slate-700 px-4 py-2 text-sm text-white" onClick={searchMembers}>후보 검색</button>
        <input className="min-w-56 flex-1 rounded-lg border p-2 text-sm" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="검수·승인 사유" />
      </div>
      {memberCandidates.length > 0 && <div className="mt-3 text-xs opacity-70">검색 후보: {memberCandidates.map((member) => `${text(member.member_name)}(${text(member.current_role)})`).join(", ")}</div>}
    </Panel>
    <Panel>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-black">검수 자료 {total.toLocaleString()}건 · {page}/{pageCount}쪽</h2>
        <div className="flex gap-1"><button className="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white" onClick={() => bulkAction("approve")}>선택 승인</button><button className="rounded bg-slate-600 px-3 py-1.5 text-xs text-white" onClick={() => bulkAction("exclude")}>선택 제외</button><button className="rounded bg-amber-600 px-3 py-1.5 text-xs text-white" onClick={() => bulkAction("unapprove")}>승인 취소</button></div>
      </div>
      {loadingRows ? <div className="p-8 text-center">불러오는 중…</div> : <div className="space-y-2">
        {rows.map((row) => {
          const id = text(row.id);
          const candidates = [...array(row.candidates), ...memberCandidates].filter((candidate, index, list) => list.findIndex((item) => text(item.member_id) === text(candidate.member_id)) === index);
          const approved = Boolean(row.created_history_id);
          return <div key={id} className="rounded-xl border border-[var(--hairline)] p-3">
            <div className="grid items-center gap-2 md:grid-cols-[28px_1fr_1fr_160px_160px_190px]">
              <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} />
              <button className="text-left" onClick={() => setExpanded(expanded === id ? null : id)}><strong>{text(row.person_name_raw) || "(이름 없음)"}</strong><div className="text-xs opacity-60">{text(row.person_name_normalized)} · T{text(row.source_table_no)}/R{text(row.source_row_no)}</div></button>
              <div><strong>{text(row.course_name_raw) || "(과정 없음)"}</strong><div className="text-xs opacity-60">{text(row.suggested_course_name)} · {statusLabel(row.attendance_status)}</div></div>
              <select className="rounded border p-1 text-xs" value={selectedMembers[id] ?? text(row.suggested_member_id)} onChange={(event) => setSelectedMembers((current) => ({ ...current, [id]: event.target.value }))}><option value="">성도 미연결</option>{candidates.map((member) => <option key={text(member.member_id)} value={text(member.member_id)}>{text(member.member_name)} · {text(member.current_role)}</option>)}</select>
              <select className="rounded border p-1 text-xs" value={selectedCourses[id] ?? text(row.suggested_course_id)} onChange={(event) => setSelectedCourses((current) => ({ ...current, [id]: event.target.value }))}><option value="">과정 미분류</option>{courses.map((course) => <option key={text(course.id)} value={text(course.id)}>{text(course.name)}</option>)}</select>
              <div className="flex gap-1">{approved ? <button className="rounded bg-amber-600 px-2 py-1 text-xs text-white" onClick={() => action(row, "unapprove")}>승인 취소</button> : <button className="rounded bg-emerald-600 px-2 py-1 text-xs text-white" onClick={() => action(row, "approve")}>승인</button>}<button className="rounded bg-slate-200 px-2 py-1 text-xs" onClick={() => action(row, "exclude")}>제외</button><button className="rounded border px-2 py-1 text-xs" onClick={() => action(row, "unlink")}>연결 해제</button></div>
            </div>
            {expanded === id && <div className="mt-3 grid gap-3 rounded-lg bg-[var(--accent-soft)] p-3 text-xs md:grid-cols-3">
              <div><strong>원본</strong><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify(row.raw_data, null, 2)}</pre></div>
              <div><strong>정규화/상태</strong><p className="mt-1">날짜: {text(row.date_raw)} → {text(row.completed_on || row.started_on)}</p><p>매칭: {text(row.match_status)} / 과정: {text(row.normalization_status)}</p><p>중복: {text(row.duplicate_status)}</p><p>메모: {text(row.review_note)}</p></div>
              <div><strong>성도 후보</strong>{array(row.candidates).map((candidate) => <p key={text(candidate.member_id)} className="mt-1">{text(candidate.member_name)} · {text(candidate.current_role)} · {text(candidate.birth_year)} · ****{text(candidate.phone_last4)} · 기존 {text(candidate.existing_history_count)}건</p>)}</div>
            </div>}
          </div>;
        })}
        {!rows.length && <div className="p-8 text-center opacity-60">해당 자료가 없습니다.</div>}
      </div>}
      <div className="mt-4 flex justify-center gap-2"><button disabled={page <= 1} className="rounded border px-4 py-2 disabled:opacity-30" onClick={() => setPage((value) => Math.max(value - 1, 1))}>이전</button><button disabled={page >= pageCount} className="rounded border px-4 py-2 disabled:opacity-30" onClick={() => setPage((value) => Math.min(value + 1, pageCount))}>다음</button></div>
    </Panel>
  </div>;
}

const COURSE_CATEGORIES = [
  "life_study", "discipleship", "mission_training", "family_ministry",
  "bible_training", "leadership_training", "lmtc", "other", "unclassified",
] as const;

async function postCourseResource(payload: JsonRecord): Promise<JsonRecord> {
  const { data } = await supabase.auth.getSession();
  const response = await fetch("/api/education-history/courses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify(payload),
  });
  const result = await response.json() as JsonRecord;
  if (!response.ok) throw new Error(text(result.error) || "요청이 실패했습니다.");
  return result;
}

function UnclassifiedCoursePanel({ rows, courses, reload }: { rows: JsonRecord[]; courses: JsonRecord[]; reload: () => Promise<void> }) {
  const [linkTo, setLinkTo] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState<Record<string, string>>({});
  const [newCategory, setNewCategory] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState("");

  const groups = useMemo(() => {
    const map = new Map<string, JsonRecord[]>();
    for (const row of rows) {
      const key = text(row.course_name_raw) || "(과정명 없음)";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return [...map.entries()]
      .map(([raw, items]) => ({ raw, items }))
      .sort((a, b) => b.items.length - a.items.length || a.raw.localeCompare(b.raw, "ko"));
  }, [rows]);

  async function run(raw: string, task: () => Promise<void>) {
    setBusy(raw);
    try {
      await task();
      await reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "처리하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  function attach(raw: string) {
    const courseId = linkTo[raw];
    if (!courseId) { alert("붙일 표준 과정을 선택하세요."); return; }
    void run(raw, async () => { await postCourseResource({ resource: "alias", rawCourseName: raw, courseId }); });
  }

  function createAndAttach(raw: string) {
    const name = (newName[raw] ?? raw).trim();
    if (!name) { alert("새 과정명을 입력하세요."); return; }
    void run(raw, async () => {
      const created = await postCourseResource({ name, category: newCategory[raw] ?? "life_study", default_audience: "adult" });
      await postCourseResource({ resource: "alias", rawCourseName: raw, courseId: text(created.id) });
    });
  }

  function discard(raw: string, items: JsonRecord[]) {
    if (!confirm(`"${raw}" ${items.length}건을 폐기(검수 제외)합니다. 정식 이력으로 넘어가지 않습니다.`)) return;
    void run(raw, async () => {
      const { data } = await supabase.auth.getSession();
      const ids = items.map((item) => text(item.id));
      for (let index = 0; index < ids.length; index += 50) {
        const response = await fetch("/api/education-history/review", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
          body: JSON.stringify({ rowIds: ids.slice(index, index + 50), action: "exclude", reviewNote: `과정 미분류 폐기 (${raw})` }),
        });
        if (!response.ok) throw new Error(text((await response.json() as JsonRecord).error) || "폐기에 실패했습니다.");
      }
    });
  }

  return <Panel>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <h2 className="font-black">미분류 과정 검수</h2>
      <Badge>{groups.length}종 · {rows.length}건</Badge>
    </div>
    <p className="mb-4 text-sm opacity-70">
      명부의 과정명이 표준 과정과 연결되지 않은 항목입니다. 기존 과정에 붙이거나, 새 과정으로 만들거나, 폐기하세요.
      기수는 과정명에서 빼고 <b>과정 하나로 묶는 것</b>을 권합니다.
    </p>
    {!groups.length && <div className="p-8 text-center text-sm opacity-60">미분류 과정이 없습니다.</div>}
    <div className="space-y-3">
      {groups.map(({ raw, items }) => {
        const working = busy === raw;
        const expanded = open === raw;
        return <div key={raw} className="rounded-xl border border-[var(--hairline)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm">{raw}</b>
            <Badge>{items.length}건</Badge>
            <button className="ml-auto text-xs underline opacity-70" onClick={() => setOpen(expanded ? "" : raw)}>
              {expanded ? "원본 닫기" : "원본 보기"}
            </button>
          </div>
          {expanded && <div className="mt-2 space-y-1 rounded-lg bg-[var(--bg-soft)] p-2 text-xs opacity-80">
            {items.slice(0, 10).map((item) => <p key={text(item.id)}>
              {text(item.person_name_normalized || item.person_name_raw)} · {text(item.completed_on || item.started_on || item.date_raw) || "날짜없음"} · {text(item.raw_row_text)}
            </p>)}
            {items.length > 10 && <p className="opacity-60">외 {items.length - 10}건</p>}
          </div>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <CourseSelect courses={courses} value={linkTo[raw] ?? ""} onChange={(value) => setLinkTo((prev) => ({ ...prev, [raw]: value }))} />
            <button disabled={working} className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-bold text-white disabled:opacity-40" onClick={() => attach(raw)}>
              이 과정에 붙이기
            </button>
            <span className="text-xs opacity-50">또는</span>
            <input
              className="rounded-lg border p-2 text-sm"
              value={newName[raw] ?? raw}
              onChange={(event) => setNewName((prev) => ({ ...prev, [raw]: event.target.value }))}
              placeholder="새 과정명"
            />
            <select
              className="rounded-lg border p-2 text-sm"
              value={newCategory[raw] ?? "life_study"}
              onChange={(event) => setNewCategory((prev) => ({ ...prev, [raw]: event.target.value }))}
            >
              {COURSE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
            </select>
            <button disabled={working} className="rounded-lg border border-[var(--accent)] px-3 py-2 text-sm font-bold text-[var(--accent)] disabled:opacity-40" onClick={() => createAndAttach(raw)}>
              새 과정으로 신설
            </button>
            <button disabled={working} className="ml-auto rounded-lg border px-3 py-2 text-sm opacity-70 disabled:opacity-30" onClick={() => discard(raw, items)}>
              폐기
            </button>
          </div>
        </div>;
      })}
    </div>
  </Panel>;
}

function CourseManageTab({ courses, aliases, policies, unclassifiedRows, reload }: { courses: JsonRecord[]; aliases: JsonRecord[]; policies: JsonRecord[]; unclassifiedRows: JsonRecord[]; reload: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("life_study");
  const [aliasRaw, setAliasRaw] = useState("");
  const [aliasCourse, setAliasCourse] = useState("");
  const [policyCourse, setPolicyCourse] = useState("");
  const [requirementType, setRequirementType] = useState("elective");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  async function create() {
    const { data } = await supabase.auth.getSession();
    const response = await fetch("/api/education-history/courses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` }, body: JSON.stringify({ name, category, default_audience: "adult" }) });
    if (response.ok) { setName(""); await reload(); } else alert(text((await response.json() as JsonRecord).error));
  }
  async function createResource(payload: JsonRecord) {
    const { data } = await supabase.auth.getSession();
    const response = await fetch("/api/education-history/courses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` }, body: JSON.stringify(payload) });
    if (response.ok) await reload(); else alert(text((await response.json() as JsonRecord).error));
  }
  return <div className="space-y-4">
    <UnclassifiedCoursePanel rows={unclassifiedRows} courses={courses} reload={reload} />
    <Panel><h2 className="mb-3 font-black">표준 과정 생성</h2><div className="flex flex-wrap gap-2"><input className="rounded-lg border p-2" value={name} onChange={(event) => setName(event.target.value)} placeholder="과정명" /><select className="rounded-lg border p-2" value={category} onChange={(event) => setCategory(event.target.value)}>{["life_study","discipleship","mission_training","family_ministry","bible_training","leadership_training","lmtc","other","unclassified"].map((item) => <option key={item}>{item}</option>)}</select><button onClick={create} className="rounded-lg bg-[var(--accent)] px-4 py-2 font-bold text-white">추가</button></div></Panel>
    <Panel><h2 className="mb-3 font-black">과정 별칭 연결</h2><div className="flex flex-wrap gap-2"><input className="rounded-lg border p-2" value={aliasRaw} onChange={(event) => setAliasRaw(event.target.value)} placeholder="원본 과정명" /><CourseSelect courses={courses} value={aliasCourse} onChange={setAliasCourse} /><button className="rounded-lg bg-[var(--accent)] px-4 text-white" onClick={() => createResource({ resource: "alias", rawCourseName: aliasRaw, courseId: aliasCourse })}>별칭 저장</button></div><Table headers={["원본명","표준 과정"]} rows={aliases.map((row) => [text(row.raw_course_name), text(courses.find((course) => course.id === row.course_id)?.name)])} /></Panel>
    <Panel><h2 className="mb-3 font-black">과정 정책</h2><div className="flex flex-wrap gap-2"><CourseSelect courses={courses} value={policyCourse} onChange={setPolicyCourse} /><select className="rounded-lg border p-2" value={requirementType} onChange={(event) => setRequirementType(event.target.value)}>{["basic_required","elective","not_applicable","unknown"].map((item) => <option key={item}>{item}</option>)}</select><div className="min-w-[240px]"><div className="mb-1 text-[12px] font-bold text-[var(--ink-soft)]">적용 시작일 (선택)</div><YmdSelect groupLabel="적용 시작일" value={effectiveFrom} onChange={setEffectiveFrom} minYear={POLICY_MIN_YEAR} maxYear={POLICY_MAX_YEAR} className="rounded-lg border p-2" /></div><div className="min-w-[240px]"><div className="mb-1 text-[12px] font-bold text-[var(--ink-soft)]">적용 종료일 (선택)</div><YmdSelect groupLabel="적용 종료일" value={effectiveTo} onChange={setEffectiveTo} minYear={POLICY_MIN_YEAR} maxYear={POLICY_MAX_YEAR} className="rounded-lg border p-2" /></div><button className="rounded-lg bg-[var(--accent)] px-4 text-white" onClick={() => createResource({ resource: "policy", courseId: policyCourse, requirementType, effectiveFrom, effectiveTo, policyName: "관리자 등록 정책" })}>정책 추가</button></div><Table headers={["과정","구분","시작","종료","정책명"]} rows={policies.map((row) => [text(courses.find((course) => course.id === row.course_id)?.name), text(row.requirement_type), text(row.effective_from) || "현재 기준", text(row.effective_to) || "-", text(row.policy_name)])} /></Panel>
    <Panel><Table headers={["과정명","분류","대상","활성","정렬"]} rows={courses.map((row) => [text(row.name), text(row.category), text(row.default_audience), row.active ? "활성" : "비활성", number(row.sort_order)])} /></Panel></div>;
}

function CourseSelect({ courses, value, onChange }: { courses: JsonRecord[]; value: string; onChange: (value: string) => void }) {
  return <select className="rounded-lg border p-2" value={value} onChange={(event) => onChange(event.target.value)}><option value="">표준 과정 선택</option>{courses.map((course) => <option key={text(course.id)} value={text(course.id)}>{text(course.name)}</option>)}</select>;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-4"><div className="text-xs opacity-60">{label}</div><div className="mt-1 text-xl font-black">{value}</div></div>;
}
function Table({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead><tr className="border-b border-[var(--hairline)]">{headers.map((header) => <th key={header} className="p-2 font-black">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-b border-[var(--hairline)]/60">{row.map((cell, cellIndex) => <td key={cellIndex} className="p-2 align-top">{cell || "-"}</td>)}</tr>)}</tbody></table>{rows.length === 0 && <div className="p-8 text-center text-sm opacity-60">표시할 데이터가 없습니다.</div>}</div>;
}
