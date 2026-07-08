"use client";

import type { CSSProperties, ReactNode, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Workbook } from "exceljs";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase, formatPhone } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import StudentPhotoEditor from "@/components/StudentPhotoEditor";
import PendingStudentPhotoPicker from "@/components/PendingStudentPhotoPicker";
import { saveStudentPendingPhoto } from "@/lib/studentPhotoUpload";
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  FileText,
  Lock,
  Plus,
  Save,
  Search,
  Upload,
  Users,
  X,
} from "lucide-react";

type StudentType = "정" | "체험" | "소";

interface StudentRow {
  id: string;
  student_no: number | null;
  name: string;
  student_type: string | null;
  grade: string | null;
  grade_year: number | null;
  class_no: string | null;
  order_no: number | null;
  member_id: string | null;
  teacher_id: string | null;
  school_name: string | null;
  gender: string | null;
  birth_date: string | null;
  phone: string | null;
  address: string | null;
  photo_url: string | null;
}

interface MemberRow {
  id: string;
  phone: string | null;
  birth_date: string | null;
  gender: string | null;
  address: string | null;
  photo_url: string | null;
}

interface DeptClass {
  class_no: string;
  grade_year: number | null;
  teacher_id: string | null;
  teacher_name: string | null;
}

interface EditableStudent {
  id: string;
  member_id: string | null;
  student_no: number | null;
  name: string;
  student_type: StudentType;
  grade: string;
  grade_year: number | null;
  class_no: string | null;
  order_no: number | null;
  teacher_name: string;
  school_name: string;
  phone: string;
  birth_date: string;
  gender: string;
  address: string;
  photo_url: string | null;
}

interface FamilyRow {
  relative_id: string;
  relative_name: string;
  relative_phone: string | null;
  kind: string | null;
  role: string | null;
  direction: string | null;
}

type ImportRow = {
  name: string;
  student_type: StudentType;
  student_no: number | null;
  grade_year: number | null;
  class_no: string | null;
  gender: string | null;
  birth_date: string | null;
  phone: string | null;
  address: string | null;
  school_name: string | null;
  order_no: number | null;
};

const STUDENT_TYPE_OPTIONS: StudentType[] = ["정", "체험", "소"];
const UNASSIGNED = "반 미배정";
const TEMPLATE_HEADERS = ["이름", "구분", "번호", "학년", "반", "성별", "생년월일", "연락처", "주소", "학교", "정렬순서"];
const TEMPLATE_EXAMPLE = ["김하준", "정", "12", "3", "3-1", "남", "2017-04-18", "010-1234-5678", "서울시 ...", "언약초", "12"];
const PAGE_SIZE = 12;

function birthYearForGrade(gradeYear: number): string {
  return String(new Date().getFullYear() - 6 - gradeYear);
}

export default function StudentsInfoPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<EditableStudent[]>([]);
  const [classes, setClasses] = useState<DeptClass[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<EditableStudent | null>(null);
  const [newDraft, setNewDraft] = useState<EditableStudent | null>(null);
  const [families, setFamilies] = useState<Record<string, FamilyRow[]>>({});
  const [classFilter, setClassFilter] = useState("");
  const [search, setSearch] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [page, setPage] = useState(1);
  const [newStudentPhotoFile, setNewStudentPhotoFile] = useState<File | null>(null);
  const [newStudentPhotoPreview, setNewStudentPhotoPreview] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setAuthChecked(true);

      const { data: gradeData } = await supabase.rpc("get_user_grade", { p_dept_id: deptId });
      const grade = typeof gradeData === "number" ? gradeData : Number(gradeData);
      if (Number.isNaN(grade) || grade > 2) {
        setAuthorized(false);
        setLoading(false);
        return;
      }

      setAuthorized(true);
      await loadStudents();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deptId, router]);

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedId) || null,
    [students, selectedId],
  );

  useEffect(() => {
    if (selectedStudent && !editMode) setDraft({ ...selectedStudent });
  }, [selectedStudent, editMode]);

  async function loadStudents() {
    setLoading(true);
    const [studentResp, teacherResp, classResp] = await Promise.all([
      supabase
        .from("edu_students")
        .select("id, student_no, name, student_type, grade, grade_year, class_no, order_no, member_id, teacher_id, school_name, gender, birth_date, phone, address, photo_url")
        .eq("department_id", deptId)
        .eq("is_active", true),
      supabase
        .from("edu_teachers")
        .select("id, name")
        .eq("department_id", deptId),
      supabase.rpc("list_dept_classes_full", { p_dept_id: deptId }),
    ]);

    if (studentResp.error) {
      showToast(`학생 목록을 불러오지 못했습니다: ${studentResp.error.message}`);
      setLoading(false);
      return;
    }

    const classList = ((classResp.data || []) as DeptClass[]).filter((item) => item.class_no);
    setClasses(classList);

    const rows = (studentResp.data || []) as StudentRow[];
    const teacherMap: Record<string, string> = {};
    ((teacherResp.data || []) as { id: string; name: string }[]).forEach((teacher) => {
      teacherMap[teacher.id] = teacher.name;
    });

    const memberIds = rows.map((row) => row.member_id).filter(Boolean) as string[];
    const memberMap: Record<string, MemberRow> = {};
    if (memberIds.length > 0) {
      const { data: members } = await supabase
        .from("members")
        .select("id, phone, birth_date, gender, address, photo_url")
        .in("id", memberIds);
      ((members || []) as MemberRow[]).forEach((member) => {
        memberMap[member.id] = member;
      });
    }

    const editable = rows.map((student) => {
      const member = student.member_id ? memberMap[student.member_id] : null;
      return {
        id: student.id,
        member_id: student.member_id,
        student_no: student.student_no,
        name: student.name,
        student_type: normalizeStudentType(student.student_type),
        grade: student.grade || "",
        grade_year: student.grade_year,
        class_no: student.class_no,
        order_no: student.order_no,
        teacher_name: student.teacher_id ? teacherMap[student.teacher_id] || "" : "",
        school_name: student.school_name || "",
        phone: member?.phone || student.phone || "",
        birth_date: member?.birth_date || student.birth_date || "",
        gender: member?.gender || student.gender || "",
        address: member?.address || student.address || "",
        photo_url: member?.photo_url || student.photo_url || null,
      };
    }).sort(compareStudents);

    setStudents(editable);
    setSelectedId((current) => (current && editable.some((s) => s.id === current) ? current : editable[0]?.id || ""));
    setDraft((current) => {
      if (!current || current.id === "__new__") return editable[0] ? { ...editable[0] } : null;
      const fresh = editable.find((student) => student.id === current.id);
      return fresh ? { ...fresh } : editable[0] ? { ...editable[0] } : null;
    });
    setEditMode(false);
    setLoading(false);
  }

  async function loadFamily(student: EditableStudent) {
    if (!student.member_id || families[student.id]) return;
    const { data } = await supabase.rpc("get_family_tree", { p_member_id: student.member_id });
    setFamilies((current) => ({ ...current, [student.id]: (data || []) as FamilyRow[] }));
  }

  useEffect(() => {
    if (selectedStudent) loadFamily(selectedStudent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStudent]);

  const classOptions = useMemo(() => {
    const seen = new Map<string, { label: string; count: number }>();
    students.forEach((student) => {
      const key = classLabel(student);
      const entry = seen.get(key);
      if (entry) entry.count += 1;
      else seen.set(key, { label: key, count: 1 });
    });
    return Array.from(seen.values());
  }, [students]);

  const filtered = useMemo(() => {
    const keyword = search.trim();
    return students.filter((student) => {
      if (classFilter && classLabel(student) !== classFilter) return false;
      if (keyword) {
        const haystack = [student.name, student.phone, student.school_name, student.class_no || ""].join(" ");
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });
  }, [students, classFilter, search]);

  useEffect(() => {
    setPage(1);
  }, [classFilter, search, students.length]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedStudents = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const visiblePages = useMemo(() => {
    const start = Math.max(1, Math.min(page - 3, totalPages - 6));
    const end = Math.min(totalPages, start + 6);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, [page, totalPages]);

  function selectStudent(student: EditableStudent) {
    setSelectedId(student.id);
    setDraft({ ...student });
    setEditMode(false);
    setDetailOpen(true);
  }

  function openNewStudent() {
    const firstClass = classes[0];
    const nextNo = nextStudentNo(students);
    setNewDraft({
      id: "__new__",
      member_id: null,
      student_no: nextNo,
      name: "",
      student_type: "정",
      grade: "",
      grade_year: firstClass?.grade_year ?? null,
      class_no: firstClass?.class_no ?? null,
      order_no: nextNo,
      teacher_name: firstClass?.teacher_name || "",
      school_name: "",
      phone: "",
      birth_date: firstClass?.grade_year ? birthDateWithYear("", birthYearForGrade(firstClass.grade_year)) : "",
      gender: "",
      address: "",
      photo_url: null,
    });
    setNewStudentPhotoFile(null);
    setNewStudentPhotoPreview(null);
  }

  function updateDraft<K extends keyof EditableStudent>(key: K, value: EditableStudent[K]) {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, [key]: value };
      if (key === "class_no") {
        const cls = classes.find((item) => item.class_no === value);
        next.grade_year = cls?.grade_year ?? next.grade_year;
        next.teacher_name = cls?.teacher_name || "";
      }
      return next;
    });
  }

  function updateNewDraft<K extends keyof EditableStudent>(key: K, value: EditableStudent[K]) {
    setNewDraft((current) => {
      if (!current) return current;
      const next = { ...current, [key]: value };
      if (key === "class_no") {
        const cls = classes.find((item) => item.class_no === value);
        next.grade_year = cls?.grade_year ?? next.grade_year;
        next.teacher_name = cls?.teacher_name || "";
        if (cls?.grade_year) next.birth_date = birthDateWithYear(next.birth_date, birthYearForGrade(cls.grade_year));
      }
      if (key === "grade_year" && typeof value === "number" && value > 0) {
        next.birth_date = birthDateWithYear(next.birth_date, birthYearForGrade(value));
      }
      return next;
    });
  }

  function updateStudentPhoto(studentId: string, url: string | null) {
    setStudents((current) => current.map((student) => (student.id === studentId ? { ...student, photo_url: url } : student)));
    setDraft((current) => (current?.id === studentId ? { ...current, photo_url: url } : current));
  }

  async function persistStudent(target: EditableStudent) {
    if (!target.name.trim()) {
      showToast("이름을 입력하세요");
      return null;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace("/login");
      return null;
    }

    setSaving(true);
    const response = await fetch("/api/edu/admin-student", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        dept_id: deptId,
        student_id: target.id === "__new__" ? null : target.id,
        student: {
          id: target.id === "__new__" ? null : target.id,
          name: target.name,
          student_type: target.student_type,
          student_no: target.student_no,
          grade: target.grade || null,
          grade_year: target.grade_year,
          class_no: target.class_no,
          order_no: target.order_no,
          school_name: target.school_name || null,
          phone: target.phone || null,
          birth_date: target.birth_date || null,
          gender: target.gender || null,
          address: target.address || null,
        },
        member: target.member_id
          ? {
              id: target.member_id,
              phone: target.phone || null,
              birth_date: target.birth_date || null,
              gender: target.gender || null,
              address: target.address || null,
            }
          : undefined,
      }),
    });

    const result = await response.json();
    setSaving(false);

    if (!response.ok || !result.ok) {
      showToast(result.error || "저장에 실패했습니다");
      return null;
    }

    showToast(target.id === "__new__" ? "학생을 등록했습니다" : "저장되었습니다");
    await loadStudents();
    return (result.results?.[0]?.id || target.id) as string;
  }

  async function handleSave() {
    if (!draft) return;
    await persistStudent(draft);
  }

  async function handleSaveNew() {
    if (!newDraft) return;
    if (!newDraft.grade_year) {
      showToast("학년을 선택하세요");
      return;
    }
    const savedId = await persistStudent(newDraft);
    if (savedId) {
      if (newStudentPhotoFile || newDraft.photo_url) {
        try {
          await saveStudentPendingPhoto({
            deptId,
            studentId: savedId,
            memberId: newDraft.member_id,
            file: newStudentPhotoFile,
            avatarUrl: newDraft.photo_url,
          });
          await loadStudents();
        } catch (photoError) {
          showToast(`학생은 등록됐지만 사진 저장 실패: ${photoError instanceof Error ? photoError.message : "오류"}`);
        }
      }
      setNewDraft(null);
      setNewStudentPhotoFile(null);
      setNewStudentPhotoPreview(null);
    }
  }

  function cancelEdit() {
    if (selectedStudent) setDraft({ ...selectedStudent });
    else setDraft(null);
    setEditMode(false);
  }

  async function handleFile(file: File | null) {
    setImportRows([]);
    setImportErrors([]);
    if (!file) return;
    setShowImportPanel(true);

    try {
      const rows = /\.csv$/i.test(file.name)
        ? parseCsv(await file.text())
        : await parseWorkbook(file);
      const parsed = normalizeImportRows(rows);
      setImportRows(parsed.rows);
      setImportErrors(parsed.errors);
      showToast(`${parsed.rows.length}건을 미리보기로 불러왔습니다`);
    } catch (e) {
      setImportErrors([e instanceof Error ? e.message : "파일을 읽지 못했습니다"]);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function importStudents() {
    if (importRows.length === 0) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace("/login");
      return;
    }

    setImporting(true);
    const response = await fetch("/api/edu/admin-student", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ dept_id: deptId, students: importRows }),
    });
    const result = await response.json();
    setImporting(false);

    if (!response.ok || result.failed > 0) {
      const failed = (result.results || [])
        .filter((row: { error?: string }) => row.error)
        .slice(0, 8)
        .map((row: { row: number; error: string }) => `${row.row}행: ${row.error}`);
      setImportErrors(failed.length > 0 ? failed : [result.error || "일괄 업로드에 실패했습니다"]);
      if (result.saved > 0) await loadStudents();
      return;
    }

    showToast(`${result.saved}명을 반영했습니다`);
    setImportRows([]);
    setImportErrors([]);
    setShowImportPanel(false);
    await loadStudents();
  }

  function downloadTemplate() {
    const csv = [TEMPLATE_HEADERS, TEMPLATE_EXAMPLE]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "students_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

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
              hint="학생정보관리는 임원진 이상만 사용할 수 있습니다."
            />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <PageHeader deptId={deptId} router={router} />

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4">
        <section className="overflow-hidden rounded-lg border border-hairline bg-card">
          <div className="grid gap-3 border-b border-hairline p-4 lg:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-[18px] font-extrabold text-ink">학생 명단</div>
                <div className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-[13px] font-bold text-ink-faint">
                  <Users size={14} strokeWidth={2} /> {filtered.length}명
                </div>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-[1fr_220px]">
                <div className="flex items-center gap-2 rounded-md border border-hairline bg-surface px-2.5">
                  <Search size={14} strokeWidth={2.2} className="shrink-0 text-ink-faint" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="이름, 연락처, 학교 검색"
                    className="min-h-10 w-full bg-transparent text-[15px] font-bold text-ink outline-none"
                  />
                </div>
                <select
                  value={classFilter}
                  onChange={(event) => setClassFilter(event.target.value)}
                  className="min-h-10 w-full rounded-md border border-hairline bg-card px-2 text-[14px] font-bold text-ink outline-none"
                >
                  <option value="">전체 반 ({students.length}명)</option>
                  {classOptions.map((option) => (
                    <option key={option.label} value={option.label}>{option.label} ({option.count}명)</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-start">
              <button
                type="button"
                onClick={openNewStudent}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-4 text-[14px] font-extrabold text-white"
              >
                <Plus size={16} strokeWidth={2.2} /> 학생 등록
              </button>
              <button
                type="button"
                onClick={() => setShowImportPanel((value) => !value)}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-hairline bg-card px-4 text-[14px] font-extrabold text-ink"
              >
                <Upload size={16} strokeWidth={2.2} /> 일괄 업로드
              </button>
            </div>
          </div>

          {(showImportPanel || importRows.length > 0 || importErrors.length > 0) && (
            <ImportPanel
              fileInputRef={fileInputRef}
              importRows={importRows}
              importErrors={importErrors}
              importing={importing}
              onFile={handleFile}
              onDownloadTemplate={downloadTemplate}
              onImport={importStudents}
            />
          )}

          {loading ? (
            <div className="py-14 text-center text-[15px] text-ink-faint">불러오는 중...</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-14 text-center text-[15px] leading-6 text-ink-faint">조건에 맞는 학생이 없습니다.</div>
          ) : (
            <>
              <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {pagedStudents.map((student) => (
                  <div
                    key={student.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectStudent(student)}
                    onKeyDown={(event) => { if (event.key === "Enter") selectStudent(student); }}
                    className={[
                      "min-h-[112px] cursor-pointer rounded-lg border px-3 py-3 text-left transition",
                      selectedId === student.id ? "border-amber-400 bg-amber-50" : "border-hairline bg-card hover:bg-surface",
                    ].join(" ")}
                  >
                    <div className="flex items-start gap-3">
                      <span onClick={(event) => event.stopPropagation()}>
                        <StudentPhotoEditor
                          deptId={deptId}
                          studentId={student.id}
                          memberId={student.member_id}
                          name={student.name}
                          gender={student.gender}
                          photoUrl={student.photo_url}
                          size={56}
                          onUpdate={(url) => updateStudentPhoto(student.id, url)}
                        />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[16px] font-extrabold text-ink">{student.name}</div>
                        <div className="mt-1 truncate text-[13px] font-semibold text-ink-faint">{classLabel(student)}</div>
                        <div className="mt-2 truncate text-[12px] font-semibold text-ink-faint">
                          {student.teacher_name ? `담임 ${student.teacher_name}` : "담임 미배정"}
                          {student.phone ? ` · ${formatPhone(student.phone)}` : ""}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[12px] font-bold text-ink-faint">{genderLabel(student.gender)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-4 py-3">
                <div className="text-[13px] font-bold text-ink-faint">
                  {filtered.length}명 중 {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filtered.length)}명 표시
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    disabled={page <= 1}
                    className="min-h-9 rounded-md border border-hairline bg-card px-3 text-[13px] font-extrabold text-ink disabled:opacity-40"
                  >
                    이전
                  </button>
                  {visiblePages[0] > 1 && <span className="px-1 text-[13px] font-bold text-ink-faint">...</span>}
                  {visiblePages.map((pageNo) => {
                    return (
                      <button
                        key={pageNo}
                        type="button"
                        onClick={() => setPage(pageNo)}
                        className={[
                          "min-h-9 min-w-9 rounded-md border px-2 text-[13px] font-extrabold",
                          page === pageNo ? "border-ink bg-ink text-white" : "border-hairline bg-card text-ink",
                        ].join(" ")}
                      >
                        {pageNo}
                      </button>
                    );
                  })}
                  {visiblePages[visiblePages.length - 1] < totalPages && <span className="px-1 text-[13px] font-bold text-ink-faint">...</span>}
                  <button
                    type="button"
                    onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                    disabled={page >= totalPages}
                    className="min-h-9 rounded-md border border-hairline bg-card px-3 text-[13px] font-extrabold text-ink disabled:opacity-40"
                  >
                    다음
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      {newDraft && (
        <NewStudentModal
          draft={newDraft}
          classes={classes}
          saving={saving}
          photoPreviewUrl={newStudentPhotoPreview}
          onClose={() => setNewDraft(null)}
          onSave={handleSaveNew}
          onChange={updateNewDraft}
          onPhotoFile={(file, previewUrl) => {
            setNewStudentPhotoFile(file);
            setNewStudentPhotoPreview(previewUrl);
            updateNewDraft("photo_url", null);
          }}
          onPhotoAvatar={(url) => {
            setNewStudentPhotoFile(null);
            setNewStudentPhotoPreview(null);
            updateNewDraft("photo_url", url);
          }}
        />
      )}
      {detailOpen && draft && (
        <StudentDetailModal
          deptId={deptId}
          draft={draft}
          classes={classes}
          families={families[draft.id] || []}
          editMode={editMode}
          saving={saving}
          onClose={() => {
            setDetailOpen(false);
            setEditMode(false);
          }}
          onToggleEdit={() => setEditMode((value) => !value)}
          onChange={updateDraft}
          onSave={handleSave}
          onCancel={cancelEdit}
          onPhotoUpdate={updateStudentPhoto}
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
      <button className="app-header-back" onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>부서홈</button>
      <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <FileText size={18} strokeWidth={1.8} /> 학생정보관리
      </div>
    </div>
  );
}

function ImportPanel({
  fileInputRef,
  importRows,
  importErrors,
  importing,
  onFile,
  onDownloadTemplate,
  onImport,
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  importRows: ImportRow[];
  importErrors: string[];
  importing: boolean;
  onFile: (file: File | null) => void;
  onDownloadTemplate: () => void;
  onImport: () => void;
}) {
  return (
    <div className="border-b border-hairline bg-surface p-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="rounded-md border border-hairline bg-card p-3 text-[13px] font-semibold leading-6 text-ink-mid">
          <div><span className="font-extrabold text-ink">지원 파일</span> CSV(.csv), 엑셀(.xlsx)</div>
          <div><span className="font-extrabold text-ink">필수 컬럼</span> 이름</div>
          <div><span className="font-extrabold text-ink">선택 컬럼</span> 구분, 번호, 학년, 반, 성별, 생년월일, 연락처, 주소, 학교, 정렬순서</div>
          <div className="mt-2 overflow-x-auto rounded border border-hairline bg-surface p-2 text-[12px]">
            이름,구분,번호,학년,반,성별,생년월일,연락처,주소,학교,정렬순서<br />
            김하준,정,12,3,3-1,남,2017-04-18,010-1234-5678,서울시 ...,언약초,12
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:w-[260px]">
          <button type="button" onClick={onDownloadTemplate} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-hairline bg-card text-[13px] font-extrabold text-ink">
            <Download size={15} strokeWidth={2.1} /> 예시 CSV
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink text-[13px] font-extrabold text-white">
            <Upload size={15} strokeWidth={2.1} /> 파일 선택
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => onFile(event.target.files?.[0] || null)}
            className="hidden"
          />
        </div>
      </div>

      {importErrors.length > 0 && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-[13px] font-semibold leading-6 text-red-800">
          {importErrors.map((error) => <div key={error}>· {error}</div>)}
        </div>
      )}

      {importRows.length > 0 && (
        <div className="mt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[13px] font-extrabold text-ink">미리보기 {importRows.length}명</div>
            <button type="button" onClick={onImport} disabled={importing || importErrors.length > 0} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md bg-amber-600 px-3 text-[13px] font-extrabold text-white disabled:opacity-50">
              <FileSpreadsheet size={14} strokeWidth={2.1} /> {importing ? "반영 중..." : "명단 반영"}
            </button>
          </div>
          <div className="max-h-56 overflow-auto rounded-md border border-hairline bg-card">
            <table className="w-full min-w-[560px] text-left text-[12px]">
              <thead className="bg-surface text-ink-faint">
                <tr>
                  <th className="px-2 py-2">이름</th>
                  <th className="px-2 py-2">구분</th>
                  <th className="px-2 py-2">학년</th>
                  <th className="px-2 py-2">반</th>
                  <th className="px-2 py-2">연락처</th>
                </tr>
              </thead>
              <tbody>
                {importRows.slice(0, 20).map((row, index) => (
                  <tr key={`${row.name}-${index}`} className="border-t border-hairline">
                    <td className="px-2 py-2 font-bold text-ink">{row.name}</td>
                    <td className="px-2 py-2 text-ink-mid">{row.student_type}</td>
                    <td className="px-2 py-2 text-ink-mid">{row.grade_year || ""}</td>
                    <td className="px-2 py-2 text-ink-mid">{row.class_no || ""}</td>
                    <td className="px-2 py-2 text-ink-mid">{row.phone || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {importRows.length > 20 && <div className="mt-2 text-[12px] font-bold text-ink-faint">미리보기는 20명까지만 표시합니다.</div>}
        </div>
      )}

      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] font-semibold leading-6 text-amber-900">
        <AlertTriangle size={15} strokeWidth={2} className="mr-1 inline-block align-[-2px]" />
        같은 번호의 기존 학생이 있으면 업데이트하고, 없으면 새 학생으로 등록합니다. 번호가 비어 있으면 새 학생으로 추가됩니다.
      </div>
    </div>
  );
}

function StudentDetailModal({
  deptId,
  draft,
  classes,
  families,
  editMode,
  saving,
  onClose,
  onToggleEdit,
  onChange,
  onSave,
  onCancel,
  onPhotoUpdate,
}: {
  deptId: string;
  draft: EditableStudent;
  classes: DeptClass[];
  families: FamilyRow[];
  editMode: boolean;
  saving: boolean;
  onClose: () => void;
  onToggleEdit: () => void;
  onChange: <K extends keyof EditableStudent>(key: K, value: EditableStudent[K]) => void;
  onSave: () => void;
  onCancel: () => void;
  onPhotoUpdate: (studentId: string, url: string | null) => void;
}) {
  return (
    <div style={modalBackdropStyle} role="presentation" onMouseDown={onClose}>
      <div style={wideModalCardStyle} role="dialog" aria-modal="true" aria-label="학생 상세" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <StudentPhotoEditor
              deptId={deptId}
              studentId={draft.id}
              memberId={draft.member_id}
              name={draft.name || "학생"}
              gender={draft.gender}
              photoUrl={draft.photo_url}
              size={78}
              onUpdate={(url) => onPhotoUpdate(draft.id, url)}
            />
            <div className="min-w-0">
              <div className="truncate text-[19px] font-extrabold text-ink">{draft.name || "새 학생"}</div>
              <div className="mt-1 text-[13px] font-semibold text-ink-faint">
                {classLabel(draft)}{draft.teacher_name ? ` · 담임 ${draft.teacher_name}` : ""}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onToggleEdit}
              className={[
                "inline-flex min-h-10 items-center justify-center rounded-md border px-3 text-[14px] font-extrabold",
                editMode ? "border-amber-400 bg-amber-50 text-amber-800" : "border-hairline bg-card text-ink-soft",
              ].join(" ")}
            >
              {editMode ? "수정 중" : "수정"}
            </button>
            <button type="button" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-hairline bg-card text-ink-soft">
              <X size={17} strokeWidth={2.2} />
            </button>
          </div>
        </div>

        <div className="grid max-h-[72vh] gap-4 overflow-y-auto p-4 lg:grid-cols-2">
          <Panel title="학생 정보">
            <InfoField label="이름" editMode={editMode} value={draft.name || "미등록"}>
              <input value={draft.name} onChange={(event) => onChange("name", event.target.value)} className={inputClass} />
            </InfoField>
            <InfoField label="구분" editMode={editMode} value={draft.student_type}>
              <select value={draft.student_type} onChange={(event) => onChange("student_type", normalizeStudentType(event.target.value))} className={inputClass}>
                {STUDENT_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </InfoField>
            <InfoField label="번호" editMode={editMode} value={draft.student_no ? String(draft.student_no) : "미등록"}>
              <input type="number" value={draft.student_no ?? ""} onChange={(event) => onChange("student_no", numberOrNull(event.target.value))} className={inputClass} />
            </InfoField>
            <InfoField label="학년" editMode={editMode} value={draft.grade_year ? `${draft.grade_year}학년` : "미등록"}>
              <input type="number" value={draft.grade_year ?? ""} onChange={(event) => onChange("grade_year", numberOrNull(event.target.value))} className={inputClass} />
            </InfoField>
            <InfoField label="반" editMode={editMode} value={classLabel(draft)}>
              <select value={draft.class_no || ""} onChange={(event) => onChange("class_no", event.target.value || null)} className={inputClass}>
                <option value="">반 미배정</option>
                {classes.map((item) => (
                  <option key={item.class_no} value={item.class_no}>
                    {classLabel({ grade_year: item.grade_year, class_no: item.class_no })}
                    {item.teacher_name ? ` / ${item.teacher_name}` : ""}
                  </option>
                ))}
              </select>
            </InfoField>
            <InfoField label="학교" editMode={editMode} value={draft.school_name || "미등록"}>
              <input value={draft.school_name} onChange={(event) => onChange("school_name", event.target.value)} className={inputClass} />
            </InfoField>
          </Panel>

          <Panel title="인적사항">
            {!draft.member_id && editMode && (
              <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] leading-6 text-amber-900">
                교적과 연결되지 않은 학생입니다. 연락처·생년월일·주소는 학생 명단 보조 정보로 저장됩니다.
              </div>
            )}
            <InfoField label="성별" editMode={editMode} value={genderLabel(draft.gender)}>
              <select value={draft.gender} onChange={(event) => onChange("gender", event.target.value)} className={inputClass}>
                <option value="">미등록</option>
                <option value="M">남</option>
                <option value="F">여</option>
              </select>
            </InfoField>
            <InfoField label="생년월일" editMode={editMode} value={draft.birth_date || "미등록"}>
              <input type="date" value={draft.birth_date} onChange={(event) => onChange("birth_date", event.target.value)} className={inputClass} />
            </InfoField>
            <InfoField label="본인연락처" editMode={editMode} value={draft.phone ? formatPhone(draft.phone) : "미등록"}>
              <input value={draft.phone} onChange={(event) => onChange("phone", event.target.value)} placeholder="010-0000-0000" className={inputClass} />
            </InfoField>
            <InfoField label="주소" editMode={editMode} value={draft.address || "미등록"}>
              <input value={draft.address} onChange={(event) => onChange("address", event.target.value)} className={inputClass} />
            </InfoField>
          </Panel>

          <Panel title="가족관계" wide>
            {families.length === 0 ? (
              <div className="rounded-md border border-hairline bg-card px-3 py-4 text-[14px] font-semibold text-ink-faint">등록된 가족관계가 없습니다.</div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {families.map((family) => (
                  <div key={`${family.relative_id}-${family.kind}-${family.direction}`} className="rounded-md border border-hairline bg-card px-3 py-2">
                    <div className="text-[14px] font-extrabold text-ink">{relationLabel(family)} · {family.relative_name}</div>
                    <div className="mt-1 text-[13px] font-semibold text-ink-faint">{family.relative_phone ? formatPhone(family.relative_phone) : "연락처 없음"}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {editMode && (
          <div className="flex gap-2 border-t border-hairline p-4">
            <button type="button" onClick={onCancel} disabled={saving} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-bg-soft text-[15px] font-extrabold text-ink-mid">
              <X size={16} strokeWidth={2.2} /> 취소
            </button>
            <button type="button" onClick={onSave} disabled={saving} className="inline-flex min-h-11 flex-[1.5] items-center justify-center gap-2 rounded-md bg-ink text-[15px] font-extrabold text-white disabled:opacity-60">
              <Save size={16} strokeWidth={2.2} /> {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function NewStudentModal({
  draft,
  classes,
  saving,
  photoPreviewUrl,
  onClose,
  onSave,
  onChange,
  onPhotoFile,
  onPhotoAvatar,
}: {
  draft: EditableStudent;
  classes: DeptClass[];
  saving: boolean;
  photoPreviewUrl: string | null;
  onClose: () => void;
  onSave: () => void;
  onChange: <K extends keyof EditableStudent>(key: K, value: EditableStudent[K]) => void;
  onPhotoFile: (file: File, previewUrl: string) => void;
  onPhotoAvatar: (url: string) => void;
}) {
  const gradeOptions = gradeOptionsFromClasses(classes);
  const birth = splitBirthDate(draft.birth_date);
  const setBirthPart = (part: "year" | "month" | "day", value: string) => {
    const clean = value.replace(/\D/g, "").slice(0, part === "year" ? 4 : 2);
    const next = { ...birth, [part]: clean };
    onChange("birth_date", birthDateFromParts(next.year, next.month, next.day));
  };
  const setGrade = (value: string) => {
    const grade = numberOrNull(value);
    onChange("grade_year", grade);
    if (grade) onChange("birth_date", birthDateWithYear(draft.birth_date, birthYearForGrade(grade)));
  };

  return (
    <div style={modalBackdropStyle} role="presentation" onMouseDown={onClose}>
      <div style={modalCardStyle} role="dialog" aria-modal="true" aria-label="학생 등록" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
          <div>
            <div className="text-[18px] font-extrabold text-ink">학생 등록</div>
            <div className="mt-1 text-[12px] font-semibold text-ink-faint">학년을 선택하면 생년 연도가 자동으로 채워집니다.</div>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-hairline bg-card text-ink-soft">
            <X size={17} strokeWidth={2.2} />
          </button>
        </div>

        <div className="grid max-h-[70vh] gap-4 overflow-y-auto p-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <PendingStudentPhotoPicker
              name={draft.name}
              gender={draft.gender}
              seed={draft.name || "new-student"}
              photoUrl={draft.photo_url}
              previewUrl={photoPreviewUrl}
              onAvatar={onPhotoAvatar}
              onFile={onPhotoFile}
            />
          </div>
          <Field label="이름 *">
            <input value={draft.name} onChange={(event) => onChange("name", event.target.value)} className={inputClass} autoFocus />
          </Field>
          <Field label="구분">
            <select value={draft.student_type} onChange={(event) => onChange("student_type", normalizeStudentType(event.target.value))} className={inputClass}>
              {STUDENT_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </Field>
          <Field label="성별">
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "M", label: "남" },
                { value: "F", label: "여" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onChange("gender", option.value)}
                  className={[
                    "min-h-11 rounded-md border text-[15px] font-extrabold",
                    draft.gender === option.value ? "border-amber-400 bg-amber-50 text-ink" : "border-hairline bg-card text-ink-soft",
                  ].join(" ")}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="학년 *">
            <select value={draft.grade_year ?? ""} onChange={(event) => setGrade(event.target.value)} className={inputClass}>
              <option value="">학년 선택</option>
              {gradeOptions.map((grade) => <option key={grade} value={grade}>{grade}학년</option>)}
            </select>
          </Field>
          <Field label="반">
            <select value={draft.class_no || ""} onChange={(event) => onChange("class_no", event.target.value || null)} className={inputClass}>
              <option value="">반 미배정</option>
              {classes.map((item) => (
                <option key={item.class_no} value={item.class_no}>
                  {classLabel({ grade_year: item.grade_year, class_no: item.class_no })}
                  {item.teacher_name ? ` / ${item.teacher_name}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="생년월일 — 학년 선택 시 연도 자동">
            <div className="grid grid-cols-3 gap-2">
              <input value={birth.year} onChange={(event) => setBirthPart("year", event.target.value)} placeholder="년" inputMode="numeric" className={inputClass} />
              <input value={birth.month} onChange={(event) => setBirthPart("month", event.target.value)} placeholder="월" inputMode="numeric" className={inputClass} />
              <input value={birth.day} onChange={(event) => setBirthPart("day", event.target.value)} placeholder="일" inputMode="numeric" className={inputClass} />
            </div>
          </Field>
          <Field label="번호">
            <input type="number" value={draft.student_no ?? ""} onChange={(event) => onChange("student_no", numberOrNull(event.target.value))} className={inputClass} />
          </Field>
          <Field label="학교">
            <input value={draft.school_name} onChange={(event) => onChange("school_name", event.target.value)} className={inputClass} />
          </Field>
          <Field label="연락처">
            <input value={draft.phone} onChange={(event) => onChange("phone", event.target.value)} placeholder="010-0000-0000" className={inputClass} />
          </Field>
          <Field label="주소">
            <input value={draft.address} onChange={(event) => onChange("address", event.target.value)} className={inputClass} />
          </Field>
          <div className="rounded-md border border-hairline bg-bg-soft px-3 py-2 text-[12.5px] leading-5 text-ink-soft md:col-span-2">
            반을 선택하면 해당 반 담임으로 자동 배정됩니다. 반을 비워두면 반 미배정 학생으로 등록됩니다.
          </div>
        </div>

        <div className="flex gap-2 border-t border-hairline p-4">
          <button type="button" onClick={onClose} disabled={saving} className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md bg-bg-soft text-[15px] font-extrabold text-ink-mid">
            취소
          </button>
          <button type="button" onClick={onSave} disabled={saving} className="inline-flex min-h-11 flex-[1.4] items-center justify-center gap-2 rounded-md bg-ink text-[15px] font-extrabold text-white disabled:opacity-60">
            <Save size={16} strokeWidth={2.2} /> {saving ? "등록 중..." : "등록"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-lg border border-hairline bg-surface p-4 ${wide ? "lg:col-span-2" : ""}`}>
      <div className="mb-3 text-[16px] font-extrabold text-ink">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <div className="mb-1 text-[14px] font-bold text-ink-soft">{label}</div>
      {children}
    </label>
  );
}

function InfoField({ label, value, editMode, children }: { label: string; value: string; editMode: boolean; children: ReactNode }) {
  if (editMode) return <Field label={label}>{children}</Field>;

  return (
    <div className="mb-3">
      <div className="mb-1 text-[14px] font-bold text-ink-soft">{label}</div>
      <div className="min-h-11 rounded-md border border-hairline bg-card px-3 py-2 text-[16px] font-bold leading-7 text-ink">{value}</div>
    </div>
  );
}

function classLabel(student: { grade_year: number | null; class_no: string | null }) {
  if (!student.class_no) return UNASSIGNED;
  return `${student.grade_year ? `${student.grade_year}학년 ` : ""}${student.class_no}반`;
}

function compareStudents(a: EditableStudent, b: EditableStudent) {
  const gradeA = a.grade_year ?? 99;
  const gradeB = b.grade_year ?? 99;
  if (gradeA !== gradeB) return gradeA - gradeB;
  if ((a.class_no === null) !== (b.class_no === null)) return a.class_no === null ? 1 : -1;
  if (a.class_no && b.class_no && a.class_no !== b.class_no) return a.class_no.localeCompare(b.class_no, "ko");
  const orderA = a.order_no ?? 9999;
  const orderB = b.order_no ?? 9999;
  if (orderA !== orderB) return orderA - orderB;
  const noA = a.student_no ?? 9999;
  const noB = b.student_no ?? 9999;
  if (noA !== noB) return noA - noB;
  return a.name.localeCompare(b.name, "ko");
}

function normalizeStudentType(value: string | null | undefined): StudentType {
  return STUDENT_TYPE_OPTIONS.includes(value as StudentType) ? (value as StudentType) : "정";
}

function genderLabel(value: string | null | undefined) {
  if (value === "M" || value === "남") return "남";
  if (value === "F" || value === "여") return "여";
  return "미등록";
}

function relationLabel(row: FamilyRow) {
  if (row.role === "father") return "부";
  if (row.role === "mother") return "모";
  if (row.kind === "spouse") return "배우자";
  if (row.direction === "descendant") return "자녀";
  if (row.direction === "sibling") return "형제";
  return row.role || row.kind || "가족";
}

function numberOrNull(value: string) {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function gradeOptionsFromClasses(classes: DeptClass[]) {
  const grades = Array.from(new Set(classes.map((item) => item.grade_year).filter((grade): grade is number => !!grade))).sort((a, b) => a - b);
  return grades.length > 0 ? grades : [1, 2, 3, 4, 5, 6];
}

function splitBirthDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return { year: "", month: "", day: "" };
  return {
    year: match[1],
    month: match[2] === "01" ? "" : String(Number(match[2])),
    day: match[3] === "01" ? "" : String(Number(match[3])),
  };
}

function birthDateWithYear(current: string, year: string) {
  const parts = splitBirthDate(current);
  return birthDateFromParts(year, parts.month, parts.day);
}

function birthDateFromParts(year: string, month: string, day: string) {
  if (!/^\d{4}$/.test(year)) return "";
  const mm = String(Math.min(12, Math.max(1, Number(month) || 1))).padStart(2, "0");
  const dd = String(Math.min(31, Math.max(1, Number(day) || 1))).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function nextStudentNo(students: EditableStudent[]) {
  const max = students.reduce((acc, student) => Math.max(acc, student.student_no || 0), 0);
  return max + 1;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const clean = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  row.push(cell.trim());
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim()));
}

async function parseWorkbook(file: File) {
  if (!/\.xlsx$/i.test(file.name)) throw new Error("엑셀은 .xlsx 파일만 지원합니다");
  const workbook = new Workbook();
  const buffer = await file.arrayBuffer();
  const load = workbook.xlsx.load.bind(workbook.xlsx) as (data: ArrayBuffer) => Promise<unknown>;
  await load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("첫 번째 시트를 찾을 수 없습니다");

  const rows: string[][] = [];
  sheet.eachRow((worksheetRow) => {
    const values = worksheetRow.values;
    const cells: string[] = [];
    if (Array.isArray(values)) {
      for (let i = 1; i < values.length; i++) cells.push(cellText(values[i]));
    }
    if (cells.some((cell) => cell.trim())) rows.push(cells);
  });
  return rows;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const rich = value as { text?: string; result?: unknown; hyperlink?: string; richText?: Array<{ text: string }> };
    if (typeof rich.text === "string") return rich.text;
    if (rich.result !== undefined) return cellText(rich.result);
    if (Array.isArray(rich.richText)) return rich.richText.map((part) => part.text).join("");
  }
  return String(value).trim();
}

function normalizeImportRows(rows: string[][]) {
  const errors: string[] = [];
  if (rows.length < 2) return { rows: [] as ImportRow[], errors: ["헤더와 학생 데이터가 필요합니다"] };

  const headers = rows[0].map(normalizeHeader);
  const index = (names: string[]) => headers.findIndex((header) => names.includes(header));
  const nameIdx = index(["name", "이름", "성명"]);
  if (nameIdx < 0) return { rows: [] as ImportRow[], errors: ["필수 컬럼 '이름'이 없습니다"] };

  const col = {
    type: index(["type", "studenttype", "구분", "학생구분"]),
    no: index(["no", "studentno", "번호", "순번"]),
    grade: index(["gradeyear", "grade", "학년"]),
    classNo: index(["classno", "class", "반"]),
    gender: index(["gender", "성별"]),
    birth: index(["birthdate", "birth", "생년월일"]),
    phone: index(["phone", "mobile", "연락처", "전화번호"]),
    address: index(["address", "주소"]),
    school: index(["school", "schoolname", "학교"]),
    order: index(["orderno", "order", "정렬순서"]),
  };

  const parsed: ImportRow[] = [];
  rows.slice(1).forEach((row, offset) => {
    const line = offset + 2;
    const name = (row[nameIdx] || "").trim();
    if (!name) {
      errors.push(`${line}행: 이름이 비어 있습니다`);
      return;
    }
    const gradeYear = col.grade >= 0 ? numberOrNull(row[col.grade] || "") : null;
    const studentNo = col.no >= 0 ? numberOrNull(row[col.no] || "") : null;
    const orderNo = col.order >= 0 ? numberOrNull(row[col.order] || "") : null;
    const birth = col.birth >= 0 ? normalizeDate(row[col.birth]) : null;
    if (col.birth >= 0 && row[col.birth] && !birth) errors.push(`${line}행: 생년월일은 YYYY-MM-DD 형식으로 입력하세요`);

    parsed.push({
      name,
      student_type: normalizeStudentType(col.type >= 0 ? row[col.type] : null),
      student_no: studentNo,
      grade_year: gradeYear,
      class_no: col.classNo >= 0 ? cleanOrNull(row[col.classNo]) : null,
      gender: col.gender >= 0 ? normalizeGender(row[col.gender]) : null,
      birth_date: birth,
      phone: col.phone >= 0 ? cleanOrNull(row[col.phone]) : null,
      address: col.address >= 0 ? cleanOrNull(row[col.address]) : null,
      school_name: col.school >= 0 ? cleanOrNull(row[col.school]) : null,
      order_no: orderNo,
    });
  });

  return { rows: parsed, errors };
}

function normalizeHeader(value: string) {
  return value.replace(/\s|_|-/g, "").toLowerCase();
}

function cleanOrNull(value: string | undefined) {
  const text = (value || "").trim();
  return text || null;
}

function normalizeGender(value: string | undefined) {
  const text = (value || "").trim();
  if (text === "M" || text === "남" || text === "남자") return "M";
  if (text === "F" || text === "여" || text === "여자") return "F";
  return null;
}

function normalizeDate(value: string | undefined) {
  const text = (value || "").trim();
  if (!text) return null;
  const ymd = text.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return null;
}

const inputClass = "min-h-11 w-full rounded-md border border-hairline-strong bg-card px-3 py-2 text-[16px] font-bold text-ink outline-none focus:border-amber-400 disabled:bg-bg-soft disabled:text-ink-faint";

const pageStyle: CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif", overflowX: "hidden" };
const headerStyle: CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
const titleStyle: CSSProperties = { fontSize: 19, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 };
const backBtnStyle: CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
const toastStyle: CSSProperties = { position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(43, 39, 34,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 14, fontWeight: 700, zIndex: 1100, fontFamily: "inherit", whiteSpace: "nowrap" };
const modalBackdropStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 1050, background: "rgba(0,0,0,0.38)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
const modalCardStyle: CSSProperties = { width: "min(720px, 100%)", maxHeight: "calc(100vh - 32px)", overflow: "hidden", borderRadius: 8, background: "var(--card)", border: "1px solid var(--hairline)", boxShadow: "0 18px 60px rgba(0,0,0,0.22)" };
const wideModalCardStyle: CSSProperties = { ...modalCardStyle, width: "min(980px, 100%)" };
