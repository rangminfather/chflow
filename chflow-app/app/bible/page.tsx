"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type TouchEvent } from "react";
import { useRouter } from "next/navigation";
import { BookText, ChevronLeft, ChevronRight, X, LayoutGrid } from "lucide-react";
import HeaderLogo from "@/components/HeaderLogo";
import BibleAttribution from "@/components/BibleAttribution";
import ModalBackdrop from "@/components/ModalBackdrop";
import { Spinner } from "@/components/StatusViews";
import { supabase } from "@/lib/supabase";
import { DEFAULT_BIBLE_VERSION, parseBibleVersions, type BibleVersion } from "@/lib/bible/versions";

type Testament = "OT" | "NT";
type Book = { book_id: number; name_ko: string; chapters: number; testament: Testament; book_order: number };
type Verse = { chapter: number; verse: number; endVerse?: number; text: string };
type PickerStep = "book" | "chapter";

const SWIPE_MIN_DISTANCE = 60;

// 1(기본) ~ 5(가장 크게) — 50대 이상 사용자를 위한 본문 글자 크기 (px)
const VERSE_FONT_SIZES = [15, 17, 19, 22, 25];
const VERSE_FONT_LEVEL_KEY = "bible-verse-font-level";

function loadVerseFontLevel(): number {
  if (typeof window === "undefined") return 1;
  const saved = Number(window.localStorage.getItem(VERSE_FONT_LEVEL_KEY));
  return saved >= 1 && saved <= 5 ? saved : 1;
}

// 원문에 "<천지 창조>" 처럼 절 맨 앞에 소제목이 붙어 있으면 본문과 붙어 나오지 않도록
// 따로 떼어낸다 — 소제목은 그 줄 위에, 본문은 다음 줄에 표시한다.
function splitVerseHeading(text: string): { heading: string | null; body: string } {
  const m = text.match(/^\s*(<[^>]+>)\s*/);
  if (!m) return { heading: null, body: text };
  return { heading: m[1], body: text.slice(m[0].length) };
}

export default function BiblePage() {
  const router = useRouter();
  const [books, setBooks] = useState<Book[]>([]);
  const [bookId, setBookId] = useState(1);
  const [chapter, setChapter] = useState(1);
  const [verses, setVerses] = useState<Verse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState<BibleVersion | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerStep, setPickerStep] = useState<PickerStep>("book");
  const [pickerTestament, setPickerTestament] = useState<Testament>("OT");
  const [slide, setSlide] = useState<"in-from-left" | "in-from-right" | null>(null);
  const [verseFontLevel, setVerseFontLevelState] = useState(1);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setVerseFontLevelState(loadVerseFontLevel()); }, []);

  // 장을 옮기면 맨 위부터 읽도록 스크롤을 되돌린다
  useEffect(() => { scrollAreaRef.current?.scrollTo(0, 0); }, [bookId, chapter]);

  function setVerseFontLevel(level: number) {
    setVerseFontLevelState(level);
    try { window.localStorage.setItem(VERSE_FONT_LEVEL_KEY, String(level)); } catch { /* 저장 실패는 무시 */ }
  }

  const book = books.find((item) => item.book_id === bookId);
  const bookIndex = books.findIndex((item) => item.book_id === bookId);
  const touchRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data } = await supabase.rpc("list_bible_books");
      const list = (Array.isArray(data) ? data : []) as Book[];
      setBooks(list);
      if (list[0]) { setBookId(list[0].book_id); setPickerTestament(list[0].testament); }

      const { data: versionRows } = await supabase.rpc("list_bible_versions");
      const versions = parseBibleVersions(versionRows);
      setVersion(versions.find((v) => v.code === DEFAULT_BIBLE_VERSION) ?? null);
    })();
  }, [router]);

  useEffect(() => {
    if (!book) return;
    setChapter((current) => Math.min(current, book.chapters));
  }, [book]);

  useEffect(() => {
    if (!book) return;
    void (async () => {
      setLoading(true); setError("");
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const response = await fetch(`/api/bible/reference?ref=${encodeURIComponent(`${book.name_ko} ${chapter}`)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store",
      });
      const payload = await response.json() as { ok?: boolean; rows?: Verse[]; error?: string };
      if (!response.ok || !payload.ok) setError(payload.error || "성경 본문을 불러오지 못했습니다.");
      else setVerses(payload.rows || []);
      setLoading(false);
    })();
    // book 목록이 늦게 도착해 book 이 undefined → 값 있음 으로 바뀔 때도 다시 불러와야 하므로
    // bookId 가 아니라 book 자체를 의존성으로 둔다 (bookId가 안 바뀌어도 book 참조가 새로 생기는
    // 시점을 놓치면 첫 진입 시 본문을 영영 못 불러온다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapter]);

  const goTo = useCallback((nextBookId: number, nextChapter: number, direction: "next" | "prev") => {
    setSlide(direction === "next" ? "in-from-right" : "in-from-left");
    setBookId(nextBookId);
    setChapter(nextChapter);
  }, []);

  const nextChapter = useCallback(() => {
    if (!book) return;
    if (chapter < book.chapters) { goTo(book.book_id, chapter + 1, "next"); return; }
    const next = books[bookIndex + 1];
    if (next) goTo(next.book_id, 1, "next");
  }, [book, bookIndex, books, chapter, goTo]);

  const prevChapter = useCallback(() => {
    if (!book) return;
    if (chapter > 1) { goTo(book.book_id, chapter - 1, "prev"); return; }
    const prev = books[bookIndex - 1];
    if (prev) goTo(prev.book_id, prev.chapters, "prev");
  }, [book, bookIndex, books, chapter, goTo]);

  const hasPrev = bookIndex > 0 || chapter > 1;
  const hasNext = bookIndex < books.length - 1 || (book ? chapter < book.chapters : false);

  function onTouchStart(e: TouchEvent<HTMLDivElement>) {
    touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function onTouchEnd(e: TouchEvent<HTMLDivElement>) {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    if (dx < 0) nextChapter(); else prevChapter();
  }

  const otBooks = useMemo(() => books.filter((b) => b.testament === "OT"), [books]);
  const ntBooks = useMemo(() => books.filter((b) => b.testament === "NT"), [books]);

  function openPicker() {
    if (book) setPickerTestament(book.testament);
    setPickerStep("book");
    setPickerOpen(true);
  }

  // "1장"을 누르면 책 목록을 거치지 않고 현재 책의 장 목록부터 연다
  function openChapterPicker() {
    if (!book) return;
    setPickerTestament(book.testament);
    setPickerStep("chapter");
    setPickerOpen(true);
  }

  return (
    <main style={pageStyle}>
      <style>{`
        @keyframes bibleSlideFromRight { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes bibleSlideFromLeft { from { opacity: 0; transform: translateX(-16px); } to { opacity: 1; transform: translateX(0); } }
      `}</style>

      <header style={headerStyle}>
        <button aria-label="홈으로" onClick={() => router.push("/home")} style={iconButtonStyle}><ChevronLeft size={22} /></button>
        <HeaderLogo />
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: 15 }}>성경책</strong>
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{version?.name_ko ?? "개역개정"}</div>
        </div>
      </header>

      <div ref={scrollAreaRef} style={scrollAreaStyle}>
        <div style={wrapStyle}>
          <div style={stickyGroupStyle}>
            <button onClick={openPicker} style={pickerTriggerStyle}>
              <span style={testamentBadgeStyle}>{book?.testament === "NT" ? "신약" : "구약"}</span>
              <span style={pickerTriggerLabelStyle}>{book?.name_ko ?? "…"} {chapter}장</span>
              <LayoutGrid size={16} style={{ color: "var(--ink-faint)", marginLeft: "auto", flexShrink: 0 }} />
            </button>

            <div style={chapterNavBarStyle}>
              <button onClick={prevChapter} disabled={!hasPrev} style={{ ...navButtonStyle, opacity: hasPrev ? 1 : 0.3 }} aria-label="이전 장">
                <ChevronLeft size={20} />
              </button>
              <div style={chapterTitleWrapStyle}>
                <BookText size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />
                <button onClick={openPicker} style={titleBookNameStyle}>{book?.name_ko ?? "…"}</button>
                <button onClick={openChapterPicker} style={titleChapterStyle}>{chapter}장</button>
                {loading && <Spinner size={14} />}
              </div>
              <button onClick={nextChapter} disabled={!hasNext} style={{ ...navButtonStyle, opacity: hasNext ? 1 : 0.3 }} aria-label="다음 장">
                <ChevronRight size={20} />
              </button>
            </div>

            <div style={fontSizeRowStyle}>
              <span style={fontSizeLabelStyle}>글자 크기</span>
              <div style={fontSizeButtonGroupStyle}>
                {[1, 2, 3, 4, 5].map((level) => (
                  <button
                    key={level}
                    onClick={() => setVerseFontLevel(level)}
                    aria-label={`글자 크기 ${level}단계`}
                    aria-pressed={verseFontLevel === level}
                    style={{
                      ...fontSizeButtonStyle,
                      ...(verseFontLevel === level ? fontSizeButtonActiveStyle : {}),
                      fontSize: 12 + level * 2,
                    }}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div
            style={readerCardStyle}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {error && <p style={{ color: "var(--danger)", fontSize: 13, padding: "0 4px" }}>{error}</p>}

            <article
              key={`${bookId}-${chapter}`}
              style={{
                ...verseListStyle,
                fontSize: VERSE_FONT_SIZES[verseFontLevel - 1],
                animation: slide === "in-from-right" ? "bibleSlideFromRight 220ms ease-out"
                  : slide === "in-from-left" ? "bibleSlideFromLeft 220ms ease-out" : undefined,
              }}
            >
              {!error && verses.map((row) => {
                const { heading, body } = splitVerseHeading(row.text);
                return (
                  <div key={`${row.chapter}-${row.verse}`}>
                    {heading && <div style={verseHeadingStyle}>{heading}</div>}
                    <p style={verseRowStyle}>
                      <b style={verseNumStyle}>{row.endVerse ? `${row.verse}-${row.endVerse}` : row.verse}</b>
                      {body}
                    </p>
                  </div>
                );
              })}
            </article>

            <div style={swipeHintStyle}>← 좌우로 넘기면 다음·이전 장 →</div>

            <BibleAttribution slug={version?.copyright_slug} />
          </div>
        </div>
      </div>

      {pickerOpen && (
        <BookPicker
          step={pickerStep}
          testament={pickerTestament}
          otBooks={otBooks}
          ntBooks={ntBooks}
          currentBookId={bookId}
          currentChapter={chapter}
          onChangeTestament={setPickerTestament}
          onPickBook={(id) => { setPickerStep("chapter"); setBookId(id); setSlide(null); }}
          onBackToBooks={() => setPickerStep("book")}
          onPickChapter={(c) => { setChapter(c); setSlide(null); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </main>
  );
}

function BookPicker({
  step, testament, otBooks, ntBooks, currentBookId, currentChapter,
  onChangeTestament, onPickBook, onBackToBooks, onPickChapter, onClose,
}: {
  step: PickerStep;
  testament: Testament;
  otBooks: Book[];
  ntBooks: Book[];
  currentBookId: number;
  currentChapter: number;
  onChangeTestament: (t: Testament) => void;
  onPickBook: (bookId: number) => void;
  onBackToBooks: () => void;
  onPickChapter: (chapter: number) => void;
  onClose: () => void;
}) {
  const list = testament === "OT" ? otBooks : ntBooks;
  const currentBook = [...otBooks, ...ntBooks].find((b) => b.book_id === currentBookId);

  return (
    <ModalBackdrop onClose={onClose} style={{ zIndex: 200, alignItems: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={sheetStyle}>
        <div style={sheetHeaderStyle}>
          {step === "chapter" ? (
            <button onClick={onBackToBooks} style={sheetBackButtonStyle}><ChevronLeft size={18} /> 책 목록</button>
          ) : (
            <h2 style={sheetTitleStyle}>책 선택</h2>
          )}
          <button onClick={onClose} style={sheetCloseStyle} aria-label="닫기"><X size={18} /></button>
        </div>

        {step === "book" && (
          <>
            <div style={testamentTabRowStyle}>
              <button
                onClick={() => onChangeTestament("OT")}
                style={{ ...testamentTabStyle, ...(testament === "OT" ? testamentTabActiveStyle : {}) }}
              >
                구약 <span style={testamentCountStyle}>{otBooks.length}</span>
              </button>
              <button
                onClick={() => onChangeTestament("NT")}
                style={{ ...testamentTabStyle, ...(testament === "NT" ? testamentTabActiveStyle : {}) }}
              >
                신약 <span style={testamentCountStyle}>{ntBooks.length}</span>
              </button>
            </div>
            <div style={sheetScrollStyle}>
              <div style={bookGridStyle}>
                {list.map((b) => (
                  <button
                    key={b.book_id}
                    onClick={() => onPickBook(b.book_id)}
                    style={{ ...gridItemStyle, ...(b.book_id === currentBookId ? gridItemActiveStyle : {}) }}
                  >
                    {b.name_ko}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {step === "chapter" && currentBook && (
          <>
            <div style={chapterPickerHeadStyle}>{currentBook.name_ko}</div>
            <div style={sheetScrollStyle}>
              <div style={chapterGridStyle}>
                {Array.from({ length: currentBook.chapters }, (_, i) => i + 1).map((c) => (
                  <button
                    key={c}
                    onClick={() => onPickChapter(c)}
                    style={{ ...gridItemStyle, ...chapterItemStyle, ...(c === currentChapter ? gridItemActiveStyle : {}) }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </ModalBackdrop>
  );
}

// main 자체는 화면 높이에 딱 맞추고 스크롤하지 않는다 — 헤더는 위에 고정된 채로 남고,
// 그 아래 scrollAreaStyle 영역 하나만 스크롤된다. 이렇게 하면 그 안의 chapterNavBarStyle이
// position:sticky로 진짜 자연스럽게 붙는다 — html,body의 overflow-x:hidden 이 sticky를
// 깨는(별도로 확인·globals.css는 안 건드림) 문제를 이 화면에서는 아예 비껴간다.
const pageStyle: CSSProperties = {
  height: "100vh",
  background: "var(--bg)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const headerStyle: CSSProperties = {
  minHeight: 60,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "0 14px",
  borderBottom: "1px solid var(--hairline)",
  background: "var(--surface)",
};

const scrollAreaStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
  WebkitOverflowScrolling: "touch",
};

const iconButtonStyle: CSSProperties = { border: 0, background: "transparent", color: "var(--ink)", padding: 8, cursor: "pointer" };

const wrapStyle: CSSProperties = { maxWidth: 760, margin: "0 auto", padding: 14 };

// 책 선택 버튼·장 제목 바·글자 크기 바 셋을 한 덩어리로 묶어서 스크롤해도 같이 붙어 있게 한다.
// 자체 배경을 깔아 둬야 스크롤되는 본문이 세 카드 사이 틈으로 비쳐 보이지 않는다.
const stickyGroupStyle: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 5,
  background: "var(--bg)",
  paddingTop: 2,
};

const pickerTriggerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "12px 14px",
  marginBottom: 10,
  background: "var(--surface)",
  border: "1px solid var(--hairline-strong)",
  borderRadius: 10,
  cursor: "pointer",
  fontFamily: "inherit",
};

const testamentBadgeStyle: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  color: "var(--accent)",
  background: "var(--accent-soft)",
  padding: "3px 8px",
  borderRadius: 999,
  flexShrink: 0,
};

const pickerTriggerLabelStyle: CSSProperties = { fontSize: 15, fontWeight: 800, color: "var(--ink)" };

const readerCardStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--hairline)",
  borderRadius: 14,
  padding: 16,
  touchAction: "pan-y",
};

const chapterNavBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 10,
  padding: "10px 12px",
  background: "var(--surface)",
  border: "1px solid var(--hairline)",
  borderRadius: 12,
  boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
};

const fontSizeRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 10,
  padding: "10px 12px",
  background: "var(--surface)",
  border: "1px solid var(--hairline)",
  borderRadius: 12,
  flexWrap: "wrap",
};

const fontSizeLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "var(--ink-soft)",
  flexShrink: 0,
};

const fontSizeButtonGroupStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const fontSizeButtonStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  minWidth: 34,
  height: 34,
  padding: "0 4px",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--hairline-strong)",
  background: "var(--card)",
  color: "var(--ink-mid)",
  fontWeight: 800,
  borderRadius: 8,
  cursor: "pointer",
  fontFamily: "inherit",
  lineHeight: 1,
};

const fontSizeButtonActiveStyle: CSSProperties = {
  background: "var(--accent)",
  borderColor: "var(--accent)",
  color: "#fff",
};

const navButtonStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 36,
  height: 36,
  flexShrink: 0,
  border: "1px solid var(--hairline-strong)",
  background: "var(--card)",
  color: "var(--ink-mid)",
  borderRadius: 8,
  cursor: "pointer",
};

const chapterTitleWrapStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  minWidth: 0,
};

// 책 이름은 눌러서 책 선택으로, 장은 눌러서 장 선택으로 이어지는 버튼이다 —
// "창세기"와 "1장" 사이를 눈에 띄게 띄워 둘이 별개임을 드러낸다.
const titleBookNameStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  fontSize: 17,
  fontWeight: 800,
  color: "var(--accent-strong)",
  textDecoration: "underline",
  textUnderlineOffset: 3,
  textDecorationColor: "var(--accent-line)",
  background: "transparent",
  border: 0,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const titleChapterStyle: CSSProperties = {
  margin: 0,
  marginLeft: 10,
  padding: 0,
  fontSize: 17,
  fontWeight: 800,
  color: "var(--ink)",
  textDecoration: "underline",
  textUnderlineOffset: 3,
  textDecorationColor: "var(--accent-line)",
  background: "transparent",
  border: 0,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const verseListStyle: CSSProperties = { minHeight: 120 };

// fontSize 는 article 에 동적으로 얹은 값(VERSE_FONT_SIZES)을 그대로 물려받는다 —
// 여기서 다시 px로 고정하면 글자 크기 버튼이 안 먹는다.
const verseRowStyle: CSSProperties = { lineHeight: 1.9, margin: "0 0 12px", color: "var(--ink)" };

const verseNumStyle: CSSProperties = {
  display: "inline-flex",
  minWidth: 20,
  color: "var(--accent)",
  fontWeight: 800,
  marginRight: 8,
};

// "<천지 창조>" 같은 절 안의 소제목 — 본문과 붙어 보이지 않게 별도 줄로 뗀다
const verseHeadingStyle: CSSProperties = {
  textAlign: "center",
  fontWeight: 800,
  color: "var(--accent-strong)",
  fontSize: "1.05em",
  margin: "18px 0 8px",
};

const swipeHintStyle: CSSProperties = {
  textAlign: "center",
  fontSize: 11,
  color: "var(--ink-faint)",
  marginTop: 4,
};

const sheetStyle: CSSProperties = {
  width: "100%",
  maxWidth: 520,
  maxHeight: "82vh",
  background: "var(--card)",
  borderRadius: "16px 16px 0 0",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const sheetHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "14px 16px",
  borderBottom: "1px solid var(--hairline)",
};

const sheetTitleStyle: CSSProperties = { margin: 0, fontSize: 15, fontWeight: 800, color: "var(--ink)" };

const sheetBackButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  fontSize: 13,
  fontWeight: 700,
  color: "var(--ink-mid)",
  background: "transparent",
  border: 0,
  cursor: "pointer",
  fontFamily: "inherit",
  padding: 0,
};

const sheetCloseStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 28,
  height: 28,
  background: "var(--surface)",
  color: "var(--ink-mid)",
  border: "1px solid var(--hairline-strong)",
  borderRadius: 999,
  cursor: "pointer",
};

const testamentTabRowStyle: CSSProperties = { display: "flex", gap: 8, padding: "12px 16px 0" };

const testamentTabStyle: CSSProperties = {
  flex: 1,
  padding: "9px 0",
  borderRadius: 8,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--hairline-strong)",
  background: "var(--surface)",
  color: "var(--ink-soft)",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
  fontFamily: "inherit",
};

const testamentTabActiveStyle: CSSProperties = {
  background: "var(--accent-soft)",
  borderColor: "var(--accent-line)",
  color: "var(--accent-strong)",
};

const testamentCountStyle: CSSProperties = { fontSize: 11, opacity: 0.7, marginLeft: 3 };

const sheetScrollStyle: CSSProperties = { padding: 16, overflowY: "auto" };

const bookGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 };

const chapterGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 };

const gridItemStyle: CSSProperties = {
  padding: "10px 4px",
  borderRadius: 8,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--hairline-strong)",
  background: "var(--surface)",
  color: "var(--ink)",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  textAlign: "center",
};

const chapterItemStyle: CSSProperties = { padding: "10px 0" };

const gridItemActiveStyle: CSSProperties = {
  background: "var(--accent)",
  borderColor: "var(--accent)",
  color: "#fff",
};

const chapterPickerHeadStyle: CSSProperties = {
  padding: "12px 16px 0",
  fontSize: 13,
  fontWeight: 800,
  color: "var(--ink-soft)",
};
