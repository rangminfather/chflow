"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, School, ShieldCheck, UserRound, Users } from "lucide-react";
import HeaderLogo from "@/components/HeaderLogo";
import { EmptyState, LoadingView } from "@/components/StatusViews";
import { supabase } from "@/lib/supabase";

interface ExecutiveRow {
  user_id: string;
  name: string;
  role: string;
  grade: number;
}

interface ClassRow {
  class_no: string;
  grade_year: number | null;
  label: string | null;
  teacher_name: string | null;
  assistant_teacher_name: string | null;
}

interface DirectoryResponse {
  ok: boolean;
  error?: string;
  department_name?: string;
  executives?: ExecutiveRow[];
  classes?: ClassRow[];
}

function classNameOf(row: ClassRow) {
  const className = row.label?.trim()
    || (row.class_no.endsWith("반") ? row.class_no : `${row.class_no}반`);
  return row.grade_year == null ? className : `${row.grade_year}학년 · ${className}`;
}

export default function DepartmentMembersPage() {
  const router = useRouter();
  const params = useParams();
  const departmentId = params.id as string;
  const [departmentName, setDepartmentName] = useState("부서");
  const [executives, setExecutives] = useState<ExecutiveRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace("/login");
      return;
    }

    try {
      const response = await fetch(`/api/departments/members?department_id=${encodeURIComponent(departmentId)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const payload = await response.json() as DirectoryResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "구성원 정보를 불러오지 못했습니다");
      setDepartmentName(payload.department_name || "부서");
      setExecutives(payload.executives || []);
      setClasses(payload.classes || []);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [departmentId, router]);

  useEffect(() => { void load(); }, [load]);

  const sortedExecutives = useMemo(
    () => [...executives].sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name, "ko")),
    [executives],
  );

  if (loading) return <LoadingView label="부서 구성원을 불러오는 중..." />;

  return (
    <main className="min-h-screen bg-[var(--bg)] pb-16 text-[var(--ink)]">
      <div className="mx-auto w-full max-w-3xl px-4 pt-5 sm:px-6">
        <HeaderLogo />

        <button
          type="button"
          onClick={() => router.back()}
          className="mt-5 inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-bold text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
        >
          <ChevronLeft size={18} /> 뒤로
        </button>

        <div className="mt-3 flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Users size={22} strokeWidth={1.9} />
          </div>
          <div>
            <h1 className="text-xl font-extrabold">{departmentName} 구성원</h1>
            <p className="mt-0.5 text-sm text-[var(--ink-soft)]">임원진과 학년·반별 담임 안내</p>
          </div>
        </div>

        {error ? (
          <div className="mt-8 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm font-bold text-[var(--danger)]">
            {error}
            <button type="button" onClick={() => void load()} className="ml-3 underline">다시 시도</button>
          </div>
        ) : (
          <div className="mt-7 space-y-8">
            <section>
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck size={18} className="text-[var(--accent)]" />
                <h2 className="text-base font-extrabold">임원진</h2>
                <span className="text-xs font-bold text-[var(--ink-faint)]">{sortedExecutives.length}명</span>
              </div>
              {sortedExecutives.length === 0 ? (
                <EmptyState message="등록된 임원진이 없습니다" />
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {sortedExecutives.map((member) => (
                    <div key={member.user_id} className="flex items-center gap-3 rounded-xl border border-[var(--hairline)] bg-[var(--card)] px-4 py-3 shadow-sm">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--bg-soft)] text-[var(--ink-soft)]">
                        <UserRound size={17} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-extrabold">{member.name}</div>
                        <div className="mt-0.5 text-xs font-bold text-[var(--accent)]">{member.role}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2">
                <School size={18} className="text-[var(--success)]" />
                <h2 className="text-base font-extrabold">학년·반별 담임</h2>
                <span className="text-xs font-bold text-[var(--ink-faint)]">{classes.length}개 반</span>
              </div>
              {classes.length === 0 ? (
                <EmptyState message="등록된 반이 없습니다" />
              ) : (
                <div className="space-y-2">
                  {classes.map((classRow) => (
                    <div key={classRow.class_no} className="rounded-xl border border-[var(--hairline)] bg-[var(--card)] px-4 py-3 shadow-sm sm:flex sm:items-center sm:justify-between">
                      <div className="text-sm font-extrabold">{classNameOf(classRow)}</div>
                      <div className="mt-2 flex flex-wrap gap-2 sm:mt-0 sm:justify-end">
                        {classRow.teacher_name ? (
                          <span className="rounded-full bg-[var(--success-soft)] px-3 py-1.5 text-xs font-bold text-[var(--success)]">담임 {classRow.teacher_name} 선생님</span>
                        ) : (
                          <span className="rounded-full bg-[var(--bg-soft)] px-3 py-1.5 text-xs font-bold text-[var(--ink-faint)]">담임 미정</span>
                        )}
                        {classRow.assistant_teacher_name && (
                          <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-bold text-[var(--accent)]">부담임 {classRow.assistant_teacher_name} 선생님</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <p className="text-center text-xs leading-5 text-[var(--ink-faint)]">개인 연락처는 표시하지 않습니다.</p>
          </div>
        )}
      </div>
    </main>
  );
}
