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

const TABS = [
  "성도별 이력", "과정별 조회", "기본필수과정 현황", "LMTC",
  "통계", "자료 가져오기", "매칭·검수", "과정 관리",
] as const;
type Tab = typeof TABS[number];
type JsonRecord = Record<string, unknown>;

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
  const [reviewRows, setReviewRows] = useState<JsonRecord[]>([]);
  const [courses, setCourses] = useState<JsonRecord[]>([]);
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
      const [batchResult, rowResult, courseMasterResult] = await Promise.all([
        supabase.from("education_import_batches").select("*").order("uploaded_at", { ascending: false }).limit(100),
        supabase.from("education_import_rows").select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("education_courses").select("*").is("deleted_at", null).order("sort_order"),
      ]);
      setBatches((batchResult.data ?? []) as JsonRecord[]);
      setReviewRows((rowResult.data ?? []) as JsonRecord[]);
      setCourses((courseMasterResult.data ?? []) as JsonRecord[]);
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
        {tab === "매칭·검수" && (canManage ? <ReviewTab rows={reviewRows} courses={courses} reload={reload} /> : <Denied />)}
        {tab === "과정 관리" && (canCourseManage ? <CourseManageTab courses={courses} reload={reload} /> : <Denied />)}
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

function ReviewTab({ rows, courses, reload }: { rows: JsonRecord[]; courses: JsonRecord[]; reload: () => Promise<void> }) {
  async function action(row: JsonRecord, value: string) {
    const { data } = await supabase.auth.getSession();
    const response = await fetch("/api/education-history/review", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
      body: JSON.stringify({ rowId: row.id, memberId: row.suggested_member_id, courseId: row.suggested_course_id, action: value }),
    });
    if (response.ok) await reload(); else alert(text((await response.json() as JsonRecord).error));
  }
  return <Panel><h2 className="mb-3 font-black">매칭·검수 대기</h2><Table headers={["원본 이름","정규화 이름","원본 과정","상태","과정 추천","작업"]} rows={rows.map((row) => [
    text(row.person_name_raw), text(row.person_name_normalized), text(row.course_name_raw), text(row.match_status),
    text(courses.find((course) => course.id === row.suggested_course_id)?.name),
    <div key={text(row.id)} className="flex gap-1"><button className="rounded bg-emerald-600 px-2 py-1 text-xs text-white" onClick={() => action(row, "approve")}>승인</button><button className="rounded bg-slate-200 px-2 py-1 text-xs" onClick={() => action(row, "exclude")}>제외</button></div>,
  ])} /></Panel>;
}

function CourseManageTab({ courses, reload }: { courses: JsonRecord[]; reload: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("life_study");
  async function create() {
    const { data } = await supabase.auth.getSession();
    const response = await fetch("/api/education-history/courses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` }, body: JSON.stringify({ name, category, default_audience: "adult" }) });
    if (response.ok) { setName(""); await reload(); } else alert(text((await response.json() as JsonRecord).error));
  }
  return <div className="space-y-4"><Panel><h2 className="mb-3 font-black">표준 과정 생성</h2><div className="flex flex-wrap gap-2"><input className="rounded-lg border p-2" value={name} onChange={(event) => setName(event.target.value)} placeholder="과정명" /><select className="rounded-lg border p-2" value={category} onChange={(event) => setCategory(event.target.value)}>{["life_study","discipleship","mission_training","family_ministry","bible_training","leadership_training","lmtc","other","unclassified"].map((item) => <option key={item}>{item}</option>)}</select><button onClick={create} className="rounded-lg bg-[var(--accent)] px-4 py-2 font-bold text-white">추가</button></div></Panel>
    <Panel><Table headers={["과정명","분류","대상","활성","정렬"]} rows={courses.map((row) => [text(row.name), text(row.category), text(row.default_audience), row.active ? "활성" : "비활성", number(row.sort_order)])} /></Panel></div>;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-4"><div className="text-xs opacity-60">{label}</div><div className="mt-1 text-xl font-black">{value}</div></div>;
}
function Table({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead><tr className="border-b border-[var(--hairline)]">{headers.map((header) => <th key={header} className="p-2 font-black">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-b border-[var(--hairline)]/60">{row.map((cell, cellIndex) => <td key={cellIndex} className="p-2 align-top">{cell || "-"}</td>)}</tr>)}</tbody></table>{rows.length === 0 && <div className="p-8 text-center text-sm opacity-60">표시할 데이터가 없습니다.</div>}</div>;
}
