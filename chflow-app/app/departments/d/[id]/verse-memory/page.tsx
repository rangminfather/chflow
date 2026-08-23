"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { supabase } from "@/lib/supabase";
import { BookOpen, ChevronLeft, ChevronRight, Download, FileDown, FileText, List, PencilLine, Plus, Settings2, Trash2, Upload, X } from "lucide-react";
import PdfCanvasViewer from "@/components/PdfCanvasViewer";

function isImageName(name: string) { return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(name); }
function isPdfName(name: string) { return /\.pdf$/i.test(name); }

type StoredAttachment = {
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
};

type VerseMemoryRow = {
  id: string;
  memory_month: string;
  title: string;
  body: string;
  attachments: StoredAttachment[];
  author_name: string | null;
  author_sub_role: string | null;
  can_delete: boolean;
  created_at: string;
};

type MonthGroup = {
  key: string; // "YYYY-MM"
  year: number;
  month: number;
  label: string;
  entries: VerseMemoryRow[];
};

const BUCKET = "dept-notice-attachments";
const MAX_FILES = 8;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function monthValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function storageUrl(path: string, download = false) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `/api/storage/${BUCKET}/${encoded}${download ? "?download=1" : ""}`;
}

export default function VerseMemoryPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;
  const currentYear = new Date().getFullYear();
  const currentKey = monthValue();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [authChecked, setAuthChecked] = useState(false);
  const [userId, setUserId] = useState("");
  const [canWrite, setCanWrite] = useState(false);
  const [year, setYear] = useState(currentYear);
  const [items, setItems] = useState<VerseMemoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 모드
  const [showList, setShowList] = useState(false);
  const [managing, setManaging] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // 이미지 크게 보기
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  // 작성 폼
  const [formOpen, setFormOpen] = useState(false);
  const [targetMonth, setTargetMonth] = useState(monthValue());
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (selectedYear: number) => {
    setLoading(true);
    setError("");
    const [{ data, error: listError }, { data: grade, error: gradeError }] = await Promise.all([
      supabase.rpc("list_dept_verse_memories", { p_department_id: deptId, p_year: selectedYear }),
      supabase.rpc("get_user_grade", { p_dept_id: deptId }),
    ]);
    if (listError || gradeError) {
      setError(listError?.message || gradeError?.message || "자료를 불러오지 못했습니다");
      setItems([]);
    } else {
      setItems((data || []) as VerseMemoryRow[]);
      setCanWrite(typeof grade === "number" && grade <= 2);
    }
    setLoading(false);
  }, [deptId]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setUserId(session.user.id);
      setAuthChecked(true);
      await load(currentYear);
    })();
  }, [currentYear, load, router]);

  // 이미지 뷰어: ESC 닫기 + 열린 동안 배경 스크롤 잠금
  useEffect(() => {
    if (!viewerUrl) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setViewerUrl(null); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; };
  }, [viewerUrl]);

  // 월별 그룹 (memory_month 기준, 최신월 우선)
  const groups: MonthGroup[] = useMemo(() => {
    const map = new Map<string, MonthGroup>();
    for (const item of items) {
      const yr = Number(item.memory_month.slice(0, 4));
      const mo = Number(item.memory_month.slice(5, 7));
      const key = `${yr}-${String(mo).padStart(2, "0")}`;
      const existing = map.get(key);
      if (existing) existing.entries.push(item);
      else map.set(key, { key, year: yr, month: mo, label: `${yr}년 ${mo}월`, entries: [item] });
    }
    return Array.from(map.values()).sort((a, b) => b.key.localeCompare(a.key));
  }, [items]);

  const activeGroup = useMemo(() => {
    if (groups.length === 0) return null;
    if (selectedKey) return groups.find((g) => g.key === selectedKey) ?? groups[0];
    const cur = groups.find((g) => g.key === currentKey);
    return cur ?? groups[0];
  }, [groups, selectedKey, currentKey]);

  const activeIdx = activeGroup ? groups.indexOf(activeGroup) : -1;

  function selectGroup(g: MonthGroup) {
    setSelectedKey(g.key);
    setShowList(false);
  }

  function selectFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length + picked.length > MAX_FILES) {
      setError(`첨부파일은 최대 ${MAX_FILES}개까지 가능합니다`);
      return;
    }
    const oversized = picked.find((file) => file.size > MAX_FILE_BYTES);
    if (oversized) {
      setError(`파일당 최대 크기는 20MB입니다: ${oversized.name}`);
      return;
    }
    setError("");
    setFiles((previous) => [...previous, ...picked]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return setError("제목을 입력하세요");
    if (!targetMonth) return setError("대상 월을 선택하세요");

    setSubmitting(true);
    setError("");
    const uploaded: StoredAttachment[] = [];

    try {
      for (const file of files) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${userId}/verse-memory/${crypto.randomUUID()}_${safeName}`;
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(`/api/storage/${BUCKET}/${path}`, { method: "POST", body: form });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || `${file.name} 업로드 실패`);
        uploaded.push({ file_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size });
      }

      const { error: createError } = await supabase.rpc("create_dept_verse_memory", {
        p_department_id: deptId,
        p_memory_month: `${targetMonth}-01`,
        p_title: title.trim(),
        p_body: body.trim(),
        p_attachments: uploaded,
      });
      if (createError) throw createError;

      setTitle("");
      setBody("");
      setFiles([]);
      setFormOpen(false);
      const selectedYear = Number(targetMonth.slice(0, 4));
      setYear(selectedYear);
      setSelectedKey(targetMonth); // 등록한 달을 바로 보여줌
      await load(selectedYear);
    } catch (caught) {
      await Promise.all(uploaded.map((file) =>
        fetch(storageUrl(file.file_path), { method: "DELETE" }).catch(() => undefined)
      ));
      setError(caught instanceof Error ? caught.message : "등록하지 못했습니다");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeItem(item: VerseMemoryRow) {
    if (!confirm(`${Number(item.memory_month.slice(5, 7))}월 「${item.title}」 자료를 삭제하시겠습니까?`)) return;
    const { data, error: deleteError } = await supabase.rpc("delete_dept_verse_memory", { p_id: item.id });
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    const attachments = (data || []) as StoredAttachment[];
    await Promise.all(attachments.map((file) =>
      fetch(storageUrl(file.file_path), { method: "DELETE" }).catch(() => undefined)
    ));
    await load(year);
  }

  if (!authChecked) return <LoadingView full />;

  const yearOptions = Array.from({ length: Math.max(1, currentYear - 2024 + 2) }, (_, index) => currentYear + 1 - index);

  return (
    <div style={pageStyle}>
      {/* 헤더 — 전역 규칙: 로고 왼쪽 / 뒤로 버튼 오른쪽 상단 / 액션 오른쪽 하단 */}
      <div className="app-subpage-header" style={headerStyle}>
        <HeaderLogo />
        <button className="app-header-back" onClick={() => router.back()} style={backButton}>← 뒤로</button>
        <div style={headerTitle}><BookOpen size={18} strokeWidth={1.8} /> 요절암송</div>
        {(canWrite || groups.length > 1) && (
          <div className="app-header-actions">
            {!managing && groups.length > 1 && (
              <button onClick={() => setShowList((v) => !v)} style={headerActionBtn(showList)}>
                <List size={15} strokeWidth={2} /> 목록
              </button>
            )}
            {canWrite && (
              <button onClick={() => { setManaging((v) => !v); setShowList(false); setFormOpen(false); }} style={headerActionBtn(managing)}>
                <Settings2 size={15} strokeWidth={2} /> 관리
              </button>
            )}
          </div>
        )}
      </div>

      <main style={mainStyle}>
        {error && <div style={errorStyle}>{error}</div>}

        {loading ? (
          <LoadingView padding={56} />
        ) : managing ? (
          /* ── 관리 모드 (권한자) ── */
          <ManageMode
            year={year}
            yearOptions={yearOptions}
            items={items}
            formOpen={formOpen}
            setFormOpen={setFormOpen}
            onChangeYear={(y) => { setYear(y); setSelectedKey(null); load(y); }}
            onDelete={removeItem}
            // 폼 props
            targetMonth={targetMonth} setTargetMonth={setTargetMonth}
            title={title} setTitle={setTitle}
            body={body} setBody={setBody}
            files={files} setFiles={setFiles}
            submitting={submitting}
            fileInputRef={fileInputRef}
            selectFiles={selectFiles}
            onSubmit={submit}
          />
        ) : groups.length === 0 ? (
          <div style={emptyWrap}>
            <EmptyState
              icon={<BookOpen size={30} />}
              message={`${year}년에 등록된 요절암송이 없습니다`}
              hint={canWrite ? "「관리」에서 자료를 올리면 이 화면에 월별로 표시됩니다." : undefined}
              padding={56}
            />
            {year !== currentYear && (
              <div style={{ textAlign: "center", paddingBottom: 18 }}>
                <button onClick={() => { setYear(currentYear); load(currentYear); }} style={ghostButton}>올해로 돌아가기</button>
              </div>
            )}
          </div>
        ) : showList ? (
          /* ── 목록 모드 ── */
          <div>
            <div style={toolbarStyle}>
              <strong style={{ fontSize: 14 }}>{year}년 요절암송</strong>
              <select value={year} onChange={(e) => { const y = Number(e.target.value); setYear(y); setSelectedKey(null); load(y); }} style={yearSelectStyle}>
                {yearOptions.map((option) => <option key={option} value={option}>{option}년</option>)}
              </select>
            </div>
            {groups.map((g) => {
              const isCurrent = g.key === currentKey;
              const isActive = activeGroup?.key === g.key;
              return (
                <button key={g.key} onClick={() => selectGroup(g)} style={listRowStyle(!!isActive)}>
                  <div>
                    <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{g.label}</span>
                    {isCurrent && <span style={badgeStyle}>이번 달</span>}
                    <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 2 }}>
                      {g.entries.length > 1 ? `자료 ${g.entries.length}개` : g.entries[0].title}
                    </div>
                  </div>
                  <ChevronRight size={16} strokeWidth={2} color="var(--ink-faint)" />
                </button>
              );
            })}
          </div>
        ) : (
          /* ── 뷰어 모드 (선생님 원클릭 보기) ── */
          activeGroup && (
            <div>
              {/* 월 내비게이션 */}
              <div style={navWrapStyle}>
                <button
                  onClick={() => activeIdx < groups.length - 1 && selectGroup(groups[activeIdx + 1])}
                  disabled={activeIdx >= groups.length - 1}
                  style={navBtnStyle(activeIdx >= groups.length - 1)}
                  aria-label="이전 달"
                >
                  <ChevronLeft size={18} strokeWidth={2} />
                </button>
                <div style={navLabelStyle}>
                  {activeGroup.label}
                  {activeGroup.key === currentKey && <span style={badgeStyle}>이번 달</span>}
                </div>
                <button
                  onClick={() => activeIdx > 0 && selectGroup(groups[activeIdx - 1])}
                  disabled={activeIdx <= 0}
                  style={navBtnStyle(activeIdx <= 0)}
                  aria-label="다음 달"
                >
                  <ChevronRight size={18} strokeWidth={2} />
                </button>
              </div>

              {/* 월 카드 */}
              <div style={listStyle}>
                {activeGroup.entries.map((item) => (
                  <article key={item.id} style={cardStyle}>
                    <div style={monthBadgeStyle}>{Number(item.memory_month.slice(5, 7))}<small>월</small></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h2 style={cardTitleStyle}>{item.title}</h2>
                      <div style={metaStyle}>{item.author_name || "작성자"}{item.author_sub_role ? ` · ${item.author_sub_role}` : ""} · {new Date(item.created_at).toLocaleDateString("ko-KR")}</div>
                      {item.body && <div style={bodyStyle}>{item.body}</div>}
                      {item.attachments?.length > 0 && (
                        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 16 }}>
                          {item.attachments.map((file) => (
                            <InlineAttachment key={file.file_path} file={file} onZoom={setViewerUrl} />
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )
        )}
      </main>

      {viewerUrl && (
        <div onClick={() => setViewerUrl(null)} style={imageViewerStyle}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewerUrl} alt="요절암송 사진 크게 보기" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          <button type="button" onClick={() => setViewerUrl(null)} style={viewerCloseStyle} aria-label="닫기"><X size={22} strokeWidth={2.4} /></button>
        </div>
      )}
    </div>
  );
}

/* ─── 첨부 인라인 표출: 이미지·PDF는 화면에 바로, 그 외는 다운로드 카드 ─── */
function InlineAttachment({ file, onZoom }: { file: StoredAttachment; onZoom?: (url: string) => void }) {
  const viewUrl = storageUrl(file.file_path);
  const downloadUrl = storageUrl(file.file_path, true);

  if (isImageName(file.file_name)) {
    return (
      <figure style={{ margin: 0 }}>
        <button type="button" onClick={() => onZoom?.(viewUrl)} style={{ display: "block", width: "100%", padding: 0, border: "none", background: "transparent", cursor: "zoom-in" }} aria-label="사진 크게 보기">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewUrl} alt={file.file_name} style={{ width: "100%", borderRadius: 12, display: "block", boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }} />
        </button>
        <a href={downloadUrl} style={downloadLinkStyle}><FileDown size={14} /> 원본 내려받기</a>
      </figure>
    );
  }

  if (isPdfName(file.file_name)) {
    return (
      <div>
        <div style={{ width: "100%", height: "75vh", borderRadius: 12, border: "1px solid var(--hairline)", overflow: "hidden", background: "var(--card)" }}>
          <PdfCanvasViewer key={viewUrl} url={`${viewUrl}?stream=1`} fallbackUrl={`${viewUrl}?download=1`} />
        </div>
        <a href={downloadUrl} style={downloadLinkStyle}><FileDown size={14} /> 원본 내려받기</a>
      </div>
    );
  }

  return (
    <a href={downloadUrl} style={attachmentStyle}>
      <FileText size={16} />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.file_name}</span>
      <span style={{ color: "var(--ink-faint)" }}>{fileSize(file.size_bytes)}</span>
      <Download size={15} />
    </a>
  );
}

/* ───────────────────────── 관리 모드 ───────────────────────── */
function ManageMode(props: {
  year: number;
  yearOptions: number[];
  items: VerseMemoryRow[];
  formOpen: boolean;
  setFormOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  onChangeYear: (y: number) => void;
  onDelete: (item: VerseMemoryRow) => void;
  targetMonth: string; setTargetMonth: (v: string) => void;
  title: string; setTitle: (v: string) => void;
  body: string; setBody: (v: string) => void;
  files: File[]; setFiles: (v: File[] | ((p: File[]) => File[])) => void;
  submitting: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  selectFiles: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const {
    year, yearOptions, items, formOpen, setFormOpen, onChangeYear, onDelete,
    targetMonth, setTargetMonth, title, setTitle, body, setBody, files, setFiles,
    submitting, fileInputRef, selectFiles, onSubmit,
  } = props;

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-soft)", lineHeight: 1.6, marginBottom: 12 }}>
        요절암송을 올리거나 삭제할 수 있습니다. 선생님들은 「{"요절암송"}」 화면에서 월별 카드로 바로 봅니다.
      </div>

      <button onClick={() => setFormOpen((v) => !v)} style={addButton}>
        {formOpen ? <X size={16} /> : <Plus size={16} />} {formOpen ? "작성 닫기" : "새 요절암송 올리기"}
      </button>

      {formOpen && (
        <form onSubmit={onSubmit} style={formStyle}>
          <div style={formHeading}>요절암송 자료 등록</div>
          <div style={formGrid}>
            <label style={fieldStyle}>
              <span style={labelStyle}>대상 월</span>
              <input type="month" value={targetMonth} onChange={(e) => setTargetMonth(e.target.value)} required style={inputStyle} />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>제목</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="예: 6월 요절암송" required style={inputStyle} />
            </label>
          </div>
          <label style={fieldStyle}>
            <span style={labelStyle}>내용</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="암송 구절과 안내 내용을 입력하세요." style={textareaStyle} />
          </label>
          <input ref={fileInputRef} type="file" multiple onChange={selectFiles} style={{ display: "none" }} accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.hwp" />
          <button type="button" onClick={() => fileInputRef.current?.click()} style={uploadButton}>
            <Upload size={16} /> 파일 첨부 ({files.length}/{MAX_FILES})
          </button>
          {files.length > 0 && (
            <div style={selectedFilesStyle}>
              {files.map((file, index) => (
                <div key={`${file.name}-${index}`} style={selectedFileStyle}>
                  <FileText size={15} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
                  <span>{fileSize(file.size)}</span>
                  <button type="button" onClick={() => setFiles((p) => p.filter((_, i) => i !== index))} style={iconButton}><X size={14} /></button>
                </div>
              ))}
            </div>
          )}
          <button type="submit" disabled={submitting} style={{ ...primaryButton, alignSelf: "flex-end", opacity: submitting ? 0.65 : 1 }}>
            <PencilLine size={16} /> {submitting ? "등록 중..." : "등록하기"}
          </button>
        </form>
      )}

      <div style={toolbarStyle}>
        <strong style={{ fontSize: 14 }}>{year}년 등록 자료</strong>
        <select value={year} onChange={(e) => onChangeYear(Number(e.target.value))} style={yearSelectStyle}>
          {yearOptions.map((option) => <option key={option} value={option}>{option}년</option>)}
        </select>
      </div>

      {items.length === 0 ? (
        <div style={emptyWrap}><EmptyState icon={<BookOpen size={28} />} message={`${year}년에 등록된 자료가 없습니다`} padding={48} /></div>
      ) : (
        <div style={listStyle}>
          {items.map((item) => (
            <div key={item.id} style={manageRowStyle}>
              <div style={monthChipStyle}>{Number(item.memory_month.slice(5, 7))}월</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", wordBreak: "break-word" }}>{item.title}</div>
                <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 2 }}>
                  {new Date(item.created_at).toLocaleDateString("ko-KR")}
                  {item.attachments?.length ? ` · 첨부 ${item.attachments.length}개` : ""}
                </div>
              </div>
              {item.can_delete && (
                <button onClick={() => onDelete(item)} style={deleteInlineButton}>
                  <Trash2 size={14} strokeWidth={2} /> 삭제
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── 스타일 ───────────────────────── */
const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", color: "var(--ink)", fontFamily: "'Noto Sans KR', sans-serif" };
const headerStyle: React.CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)" };
const headerTitle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, fontSize: 17, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 };
const backButton: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
function headerActionBtn(active: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 8, border: "none", background: active ? "var(--accent-soft)" : "var(--bg-soft)", color: active ? "var(--accent)" : "var(--ink-mid)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
}
const mainStyle: React.CSSProperties = { width: "min(820px, calc(100% - 24px))", margin: "0 auto", padding: "18px 0 48px" };

const navWrapStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 };
function navBtnStyle(disabled: boolean): React.CSSProperties {
  return { padding: "6px 10px", border: "none", borderRadius: 8, background: "var(--bg-soft)", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.3 : 1 };
}
const navLabelStyle: React.CSSProperties = { fontWeight: 800, fontSize: 17, color: "var(--ink)", display: "flex", alignItems: "center", gap: 8 };
const badgeStyle: React.CSSProperties = { marginLeft: 8, fontSize: 11, fontWeight: 700, color: "var(--accent)", background: "var(--accent-soft)", padding: "2px 7px", borderRadius: 99 };

const primaryButton: React.CSSProperties = { minHeight: 40, border: 0, borderRadius: 9, padding: "0 15px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: "var(--accent)", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
const addButton: React.CSSProperties = { ...primaryButton, width: "100%", minHeight: 46, marginBottom: 14 };
const ghostButton: React.CSSProperties = { border: "1px solid var(--hairline)", borderRadius: 8, background: "var(--card)", padding: "8px 14px", color: "var(--ink-mid)", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

const formStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 13, padding: 20, marginBottom: 14, borderRadius: 12, background: "var(--card)", border: "1px solid var(--hairline)" };
const formHeading: React.CSSProperties = { fontSize: 17, fontWeight: 850 };
const formGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(150px, 0.38fr) minmax(220px, 1fr)", gap: 12 };
const fieldStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 };
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: "var(--ink-mid)" };
const inputStyle: React.CSSProperties = { width: "100%", height: 42, border: "1px solid var(--hairline-strong)", borderRadius: 8, padding: "0 11px", background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit", fontSize: 14 };
const textareaStyle: React.CSSProperties = { ...inputStyle, height: "auto", resize: "vertical", padding: 11, lineHeight: 1.6 };
const uploadButton: React.CSSProperties = { alignSelf: "flex-start", minHeight: 38, border: "1px dashed var(--accent)", borderRadius: 8, padding: "0 12px", display: "inline-flex", alignItems: "center", gap: 6, background: "var(--accent-soft)", color: "var(--accent-strong)", fontWeight: 750, cursor: "pointer" };
const selectedFilesStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const selectedFileStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: "var(--surface)", color: "var(--ink-soft)", fontSize: 12 };
const iconButton: React.CSSProperties = { width: 26, height: 26, border: 0, borderRadius: 6, display: "grid", placeItems: "center", background: "var(--hairline)", color: "var(--ink-mid)", cursor: "pointer" };

const errorStyle: React.CSSProperties = { marginBottom: 14, padding: "11px 13px", borderRadius: 9, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, fontWeight: 700 };
const toolbarStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0 10px", padding: "0 2px" };
const yearSelectStyle: React.CSSProperties = { height: 38, border: "1px solid var(--hairline)", borderRadius: 8, padding: "0 10px", background: "var(--card)", color: "var(--ink)", fontWeight: 700 };
const emptyWrap: React.CSSProperties = { borderRadius: 12, background: "var(--card)", border: "1px solid var(--hairline)" };

function listRowStyle(active: boolean): React.CSSProperties {
  return { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", marginBottom: 8, borderRadius: 12, background: active ? "var(--accent-soft)" : "var(--card)", border: `1px solid ${active ? "var(--accent)" : "var(--hairline)"}`, cursor: "pointer", fontFamily: "inherit", textAlign: "left" };
}

const listStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 10 };
const cardStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", gap: 14, padding: 17, borderRadius: 12, background: "var(--card)", border: "1px solid var(--hairline)" };
const monthBadgeStyle: React.CSSProperties = { width: 52, height: 52, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "baseline", justifyContent: "center", paddingTop: 12, gap: 2, background: "var(--accent-soft)", color: "var(--accent-strong)", fontSize: 20, fontWeight: 900 };
const cardTitleStyle: React.CSSProperties = { margin: 0, fontSize: 17, fontWeight: 850 };
const metaStyle: React.CSSProperties = { marginTop: 4, color: "var(--ink-faint)", fontSize: 11 };
const bodyStyle: React.CSSProperties = { marginTop: 13, paddingTop: 12, borderTop: "1px solid var(--hairline)", whiteSpace: "pre-wrap", lineHeight: 1.7, color: "var(--ink-mid)", fontSize: 14 };
const attachmentStyle: React.CSSProperties = { minWidth: 0, display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--hairline)", color: "var(--ink-mid)", textDecoration: "none", fontSize: 12, fontWeight: 700 };
const downloadLinkStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", textDecoration: "none" };
const imageViewerStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16, cursor: "zoom-out" };
const viewerCloseStyle: React.CSSProperties = { position: "fixed", top: 14, right: 14, width: 42, height: 42, display: "grid", placeItems: "center", borderRadius: 99, border: "none", background: "rgba(255,255,255,0.16)", color: "#fff", cursor: "pointer" };

const manageRowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", borderRadius: 12, background: "var(--card)", border: "1px solid var(--hairline)" };
const monthChipStyle: React.CSSProperties = { flexShrink: 0, minWidth: 38, height: 30, padding: "0 9px", display: "grid", placeItems: "center", borderRadius: 8, background: "var(--accent-soft)", color: "var(--accent-strong)", fontSize: 13, fontWeight: 800 };
const deleteInlineButton: React.CSSProperties = { flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 12px", borderRadius: 9, background: "color-mix(in srgb, var(--danger) 10%, transparent)", color: "var(--danger)", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700 };
