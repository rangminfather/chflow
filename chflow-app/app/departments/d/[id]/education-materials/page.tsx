"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  BookOpen,
  Download,
  FileText,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import HeaderLogo from "@/components/HeaderLogo";
import ModalBackdrop from "@/components/ModalBackdrop";
import PdfCanvasViewer from "@/components/PdfCanvasViewer";
import { EmptyState, LoadingView } from "@/components/StatusViews";
import { useConfirm } from "@/components/ConfirmDialog";
import { supabase } from "@/lib/supabase";
import type { EducationMaterial, EducationMaterialKind } from "@/lib/educationMaterials";

type MaterialView = EducationMaterial & { pdfUrl: string; downloadUrl: string };
type MaterialTab = EducationMaterialKind;

type MaterialDraft = {
  id: string | null;
  kind: EducationMaterialKind;
  lessonNumber: string;
  title: string;
  sortOrder: string;
  currentFileName: string;
  file: File | null;
};

const NEW_DRAFT: MaterialDraft = {
  id: null,
  kind: "lesson",
  lessonNumber: "",
  title: "",
  sortOrder: "",
  currentFileName: "",
  file: null,
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "용량 정보 없음";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function materialBadge(item: MaterialView) {
  return item.kind === "lesson" && item.lessonNumber ? `${item.lessonNumber}과` : "특별절기";
}

export default function EducationMaterialsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const deptId = params.id;
  const { confirm, alert } = useConfirm();

  const [token, setToken] = useState("");
  const [deptName, setDeptName] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [materials, setMaterials] = useState<MaterialView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<MaterialTab>("lesson");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MaterialDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const loadMaterials = useCallback(async (accessToken: string, keepId?: string | null) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/edu/materials?dept_id=${encodeURIComponent(deptId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "교육자료를 불러오지 못했습니다");
      const next = (result.materials || []) as MaterialView[];
      setMaterials(next);
      setDeptName(result.deptName || "교육부서");
      setCanManage(result.canManage === true);
      setSelectedId((current) => {
        const preferred = keepId ?? current;
        if (preferred && next.some((item) => item.id === preferred)) return preferred;
        return null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "교육자료를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, [deptId]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setToken(session.access_token);
      await loadMaterials(session.access_token);
    })();
  }, [loadMaterials, router]);

  const visibleMaterials = useMemo(
    () => materials.filter((item) => item.kind === tab),
    [materials, tab],
  );
  const selected = useMemo(
    () => materials.find((item) => item.id === selectedId) || null,
    [materials, selectedId],
  );
  const viewerHeaders = useMemo(
    () => token ? { Authorization: `Bearer ${token}` } : undefined,
    [token],
  );

  function openNew() {
    setDraft({ ...NEW_DRAFT, kind: tab, sortOrder: tab === "special" ? "1000" : "" });
  }

  function openEdit(item: MaterialView) {
    setDraft({
      id: item.id,
      kind: item.kind,
      lessonNumber: item.lessonNumber ? String(item.lessonNumber) : "",
      title: item.title,
      sortOrder: String(item.sortOrder),
      currentFileName: item.originalName,
      file: null,
    });
  }

  async function saveMaterial(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || !token || saving) return;
    if (!draft.title.trim()) {
      await alert("자료 제목을 입력해 주세요.");
      return;
    }
    if (draft.kind === "lesson" && !draft.lessonNumber) {
      await alert("과 번호를 입력해 주세요.");
      return;
    }
    if (!draft.id && !draft.file) {
      await alert("PDF 파일을 선택해 주세요.");
      return;
    }

    setSaving(true);
    try {
      const form = new FormData();
      form.append("dept_id", deptId);
      form.append("title", draft.title.trim());
      form.append("kind", draft.kind);
      form.append("lesson_number", draft.kind === "lesson" ? draft.lessonNumber : "");
      form.append("sort_order", draft.sortOrder || (draft.kind === "lesson" ? draft.lessonNumber : "1000"));
      if (draft.file) form.append("file", draft.file);
      if (draft.id) form.append("material_id", draft.id);

      const response = await fetch("/api/edu/materials", {
        method: draft.id ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "교육자료 저장에 실패했습니다");
      const savedId = result.material?.id || draft.id;
      setDraft(null);
      setTab(draft.kind);
      await loadMaterials(token, savedId);
      setSelectedId(savedId);
    } catch (saveError) {
      await alert(saveError instanceof Error ? saveError.message : "교육자료 저장에 실패했습니다");
    } finally {
      setSaving(false);
    }
  }

  async function deleteMaterial(item: MaterialView) {
    if (!token || deletingId) return;
    const approved = await confirm(
      `'${item.title}' 자료를 삭제하시겠습니까?\n삭제하면 PDF도 함께 삭제되며 복구할 수 없습니다.`,
      { okText: "삭제" },
    );
    if (!approved) return;

    setDeletingId(item.id);
    try {
      const response = await fetch(
        `/api/edu/materials?dept_id=${encodeURIComponent(deptId)}&material_id=${encodeURIComponent(item.id)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "교육자료 삭제에 실패했습니다");
      if (selectedId === item.id) setSelectedId(null);
      await loadMaterials(token);
    } catch (deleteError) {
      await alert(deleteError instanceof Error ? deleteError.message : "교육자료 삭제에 실패했습니다");
    } finally {
      setDeletingId(null);
    }
  }

  async function downloadMaterial(item: MaterialView) {
    if (!token || downloadingId) return;
    setDownloadingId(item.id);
    try {
      const response = await fetch(item.downloadUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("PDF 다운로드에 실패했습니다");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.originalName || `${materialBadge(item)} 교육자료.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      await alert(downloadError instanceof Error ? downloadError.message : "PDF 다운로드에 실패했습니다");
    } finally {
      setDownloadingId(null);
    }
  }

  if (!token && loading) return <LoadingView full />;

  return (
    <div className="min-h-screen bg-bg-soft text-ink">
      <header className="app-subpage-header border-b border-hairline bg-card/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3">
          <HeaderLogo />
          <button className="app-header-back" onClick={() => router.back()}>← 뒤로</button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[18px] font-extrabold">
              <BookOpen size={19} strokeWidth={1.9} /> 교육자료
            </div>
            <div className="truncate text-[12px] font-semibold text-ink-soft">{deptName || "교육부서"} · 교사용 PDF 자료</div>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={openNew}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-extrabold text-white shadow-sm"
            >
              <Plus size={16} strokeWidth={2.2} /> <span className="hidden sm:inline">자료 등록</span><span className="sm:hidden">등록</span>
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-5 sm:py-5">
        {error ? (
          <section className="rounded-xl border border-red-200 bg-card px-5 py-12 text-center">
            <div className="text-[15px] font-extrabold text-red-600">{error}</div>
            <button onClick={() => token && loadMaterials(token)} className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-hairline px-4 py-2 text-[13px] font-bold">
              <RefreshCw size={14} /> 다시 불러오기
            </button>
          </section>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
            <section className={`${selected ? "hidden lg:flex" : "flex"} min-w-0 flex-col rounded-xl border border-hairline bg-card shadow-sm`}>
              <div className="border-b border-hairline p-3.5">
                <div className="grid grid-cols-2 rounded-lg bg-bg-soft p-1" role="tablist" aria-label="교육자료 구분">
                  {([
                    { id: "lesson" as const, label: "과별 자료" },
                    { id: "special" as const, label: "특별절기" },
                  ]).map((item) => {
                    const count = materials.filter((material) => material.kind === item.id).length;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.id}
                        onClick={() => { setTab(item.id); setSelectedId(null); }}
                        className={`min-h-10 rounded-md px-2 text-[14px] font-extrabold ${tab === item.id ? "border border-hairline bg-card text-ink shadow-sm" : "text-ink-soft"}`}
                      >
                        {item.label} <span className="text-[11px] text-ink-faint">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="min-h-[360px] flex-1 overflow-y-auto p-3 lg:max-h-[calc(100vh-190px)]">
                {loading ? (
                  <LoadingView padding={52} />
                ) : visibleMaterials.length === 0 ? (
                  <EmptyState
                    icon={<FileText size={23} strokeWidth={1.7} />}
                    message={`등록된 ${tab === "lesson" ? "과별" : "특별절기"} 자료가 없습니다`}
                    hint={canManage ? "상단의 자료 등록 버튼으로 PDF를 올릴 수 있습니다." : undefined}
                    padding={56}
                  />
                ) : (
                  <div className="space-y-2.5">
                    {visibleMaterials.map((item) => (
                      <article key={item.id} className={`rounded-lg border p-3 transition-colors ${selectedId === item.id ? "border-accent bg-accent-soft" : "border-hairline bg-surface"}`}>
                        <button type="button" onClick={() => setSelectedId(item.id)} className="flex w-full items-start gap-3 text-left">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
                            <FileText size={18} strokeWidth={1.9} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex flex-wrap items-center gap-1.5">
                              <span className="rounded-full bg-card px-2 py-0.5 text-[11px] font-extrabold text-accent-strong">{materialBadge(item)}</span>
                            </div>
                            <div className="break-keep text-[14px] font-extrabold leading-5 text-ink">{item.title}</div>
                            <div className="mt-1 text-[11px] font-semibold text-ink-faint">PDF · {formatBytes(item.sizeBytes)}</div>
                          </div>
                        </button>
                        {canManage && (
                          <div className="mt-2.5 flex justify-end gap-1 border-t border-hairline pt-2">
                            <button type="button" onClick={() => openEdit(item)} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2.5 text-[12px] font-bold text-ink-soft">
                              <Pencil size={13} /> 수정
                            </button>
                            <button type="button" onClick={() => deleteMaterial(item)} disabled={deletingId === item.id} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2.5 text-[12px] font-bold text-red-600 disabled:opacity-50">
                              {deletingId === item.id ? <LoaderCircle size={13} className="animate-spin" /> : <Trash2 size={13} />} 삭제
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className={`${selected ? "flex" : "hidden lg:flex"} min-w-0 flex-col overflow-hidden rounded-xl border border-hairline bg-card shadow-sm`}>
              {selected ? (
                <>
                  <div className="flex items-center gap-2 border-b border-hairline px-3 py-3 sm:px-4">
                    <button type="button" onClick={() => setSelectedId(null)} className="inline-flex min-h-9 items-center rounded-md border border-hairline px-2.5 text-[12px] font-bold lg:hidden">← 목록</button>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-extrabold text-accent-strong">{materialBadge(selected)}</div>
                      <h2 className="truncate text-[15px] font-extrabold sm:text-[17px]">{selected.title}</h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => downloadMaterial(selected)}
                      disabled={downloadingId === selected.id}
                      className="inline-flex min-h-9 flex-shrink-0 items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 text-[12px] font-extrabold disabled:opacity-50"
                    >
                      {downloadingId === selected.id ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />} PDF 저장
                    </button>
                  </div>
                  <div className="h-[calc(100dvh-150px)] min-h-[500px] bg-bg-soft lg:h-[calc(100vh-190px)] lg:min-h-[620px]">
                    <PdfCanvasViewer
                      key={`${selected.id}-${selected.updatedAt}`}
                      url={selected.pdfUrl}
                      fallbackUrl={selected.downloadUrl}
                      httpHeaders={viewerHeaders}
                      loadingLabel="교육자료 PDF를 불러오는 중..."
                      errorTitle="교육자료 PDF를 표시하지 못했습니다"
                    />
                  </div>
                </>
              ) : (
                <div className="flex min-h-[620px] flex-1 items-center justify-center p-8 text-center text-ink-faint">
                  <div>
                    <BookOpen size={34} strokeWidth={1.4} className="mx-auto mb-3" />
                    <div className="text-[15px] font-extrabold">왼쪽에서 자료를 선택해 주세요</div>
                    <div className="mt-1 text-[12px] font-semibold">PDF가 이 화면에서 바로 열립니다.</div>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {draft && (
        <ModalBackdrop onClose={() => !saving && setDraft(null)} style={{ zIndex: 1200 }}>
          <form onSubmit={saveMaterial} onClick={(event) => event.stopPropagation()} className="max-h-[calc(100dvh-32px)] w-[min(520px,calc(100vw-24px))] overflow-y-auto rounded-xl bg-card shadow-2xl">
            <div className="flex items-center gap-3 border-b border-hairline px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="text-[17px] font-extrabold">{draft.id ? "교육자료 수정" : "교육자료 등록"}</div>
                <div className="mt-0.5 text-[12px] font-semibold text-ink-soft">PDF 파일만 사용할 수 있습니다.</div>
              </div>
              <button type="button" onClick={() => setDraft(null)} disabled={saving} className="flex h-9 w-9 items-center justify-center rounded-lg bg-bg-soft text-ink-soft"><X size={17} /></button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-extrabold">자료 구분</span>
                <select
                  value={draft.kind}
                  onChange={(event) => setDraft({ ...draft, kind: event.target.value as EducationMaterialKind, lessonNumber: event.target.value === "special" ? "" : draft.lessonNumber })}
                  className="h-11 w-full rounded-lg border border-hairline bg-surface px-3 text-[14px] font-bold outline-none focus:border-accent"
                >
                  <option value="lesson">과별 자료</option>
                  <option value="special">특별절기</option>
                </select>
              </label>

              {draft.kind === "lesson" && (
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-extrabold">과 번호</span>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={draft.lessonNumber}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraft({
                        ...draft,
                        lessonNumber: value,
                        sortOrder: draft.sortOrder || value,
                        title: draft.title || (value ? `${value}과 교사 교육자료` : ""),
                      });
                    }}
                    className="h-11 w-full rounded-lg border border-hairline bg-surface px-3 text-[14px] font-bold outline-none focus:border-accent"
                    placeholder="예: 23"
                  />
                </label>
              )}

              <label className="block">
                <span className="mb-1.5 block text-[13px] font-extrabold">자료 제목</span>
                <input
                  type="text"
                  maxLength={120}
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  className="h-11 w-full rounded-lg border border-hairline bg-surface px-3 text-[14px] font-bold outline-none focus:border-accent"
                  placeholder={draft.kind === "lesson" ? "예: 23과 세계관 교육 자료 및 나눔" : "예: 추수감사주일"}
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[13px] font-extrabold">표시 순서</span>
                <input
                  type="number"
                  min={0}
                  max={9999}
                  value={draft.sortOrder}
                  onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })}
                  className="h-11 w-full rounded-lg border border-hairline bg-surface px-3 text-[14px] font-bold outline-none focus:border-accent"
                  placeholder={draft.kind === "lesson" ? "과 번호와 같게 입력" : "예: 1"}
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[13px] font-extrabold">{draft.id ? "PDF 교체" : "PDF 파일"}</span>
                <div className="rounded-lg border border-dashed border-accent-line bg-accent-soft p-4 text-center">
                  <UploadCloud size={25} strokeWidth={1.7} className="mx-auto mb-2 text-accent-strong" />
                  <div className="text-[13px] font-bold text-ink">
                    {draft.file?.name || draft.currentFileName || "PDF 파일을 선택해 주세요"}
                  </div>
                  {draft.id && !draft.file && <div className="mt-1 text-[11px] font-semibold text-ink-soft">파일을 선택하지 않으면 기존 PDF가 유지됩니다.</div>}
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(event) => setDraft({ ...draft, file: event.target.files?.[0] || null })}
                    className="mx-auto mt-3 block max-w-full text-[12px] font-semibold text-ink-soft file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:font-extrabold file:text-white"
                  />
                </div>
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-hairline px-5 py-4">
              <button type="button" onClick={() => setDraft(null)} disabled={saving} className="min-h-10 rounded-lg border border-hairline px-4 text-[13px] font-bold text-ink-soft">취소</button>
              <button type="submit" disabled={saving} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-accent px-5 text-[13px] font-extrabold text-white disabled:opacity-60">
                {saving ? <LoaderCircle size={15} className="animate-spin" /> : <UploadCloud size={15} />} {draft.id ? "수정 저장" : "자료 등록"}
              </button>
            </div>
          </form>
        </ModalBackdrop>
      )}
    </div>
  );
}
