"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronLeft, Search } from "lucide-react";
import HeaderLogo from "@/components/HeaderLogo";
import BibleAttribution from "@/components/BibleAttribution";
import { supabase } from "@/lib/supabase";
import { DEFAULT_BIBLE_VERSION, parseBibleVersions, type BibleVersion } from "@/lib/bible/versions";

type Book = { book_id: number; name_ko: string; chapters: number };
type Verse = { chapter: number; verse: number; endVerse?: number; text: string };

export default function BiblePage() {
  const router = useRouter();
  const [books, setBooks] = useState<Book[]>([]);
  const [bookId, setBookId] = useState(1);
  const [chapter, setChapter] = useState(1);
  const [verses, setVerses] = useState<Verse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState<BibleVersion | null>(null);
  const book = books.find((item) => item.book_id === bookId);

  useEffect(() => {
    void (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) { router.replace("/login"); return; }
      const { data } = await supabase.rpc("list_bible_books");
      const list = (Array.isArray(data) ? data : []) as Book[];
      setBooks(list);
      if (list[0]) setBookId(list[0].book_id);

      const { data: versionRows } = await supabase.rpc("list_bible_versions");
      const versions = parseBibleVersions(versionRows);
      setVersion(versions.find((v) => v.code === DEFAULT_BIBLE_VERSION) ?? null);
    })();
  }, [router]);

  useEffect(() => {
    if (!book) return;
    setChapter((current) => Math.min(current, book.chapters));
  }, [book]);

  async function load() {
    if (!book) return;
    setLoading(true); setError("");
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) { router.replace("/login"); return; }
    const response = await fetch(`/api/bible/reference?ref=${encodeURIComponent(`${book.name_ko} ${chapter}`)}`, {
      headers: { Authorization: `Bearer ${sessionData.session.access_token}` }, cache: "no-store",
    });
    const payload = await response.json() as { ok?: boolean; rows?: Verse[]; error?: string };
    if (!response.ok || !payload.ok) setError(payload.error || "성경 본문을 불러오지 못했습니다.");
    else setVerses(payload.rows || []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [book, chapter]); // eslint-disable-line react-hooks/exhaustive-deps

  return <main style={{ minHeight: "100vh", background: "var(--bg)" }}>
    <header style={{ minHeight: 64, display: "flex", alignItems: "center", gap: 12, padding: "0 16px", borderBottom: "1px solid var(--line)", background: "var(--surface)" }}>
      <button aria-label="홈으로" onClick={() => router.push("/home")} style={iconButton}><ChevronLeft size={22} /></button>
      <HeaderLogo /><div style={{ flex: 1 }}><strong>성경책</strong><div style={{ fontSize: 12, color: "var(--ink-soft)" }}>개역개정</div></div>
    </header>
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
      <div style={card}><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select value={bookId} onChange={(e) => setBookId(Number(e.target.value))} style={select}>{books.map((item) => <option key={item.book_id} value={item.book_id}>{item.name_ko}</option>)}</select>
        <select value={chapter} onChange={(e) => setChapter(Number(e.target.value))} style={select}>{Array.from({ length: book?.chapters || 1 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}장</option>)}</select>
        <button onClick={() => void load()} style={button}><Search size={16} /> 읽기</button>
      </div></div>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      <article style={{ ...card, marginTop: 12 }}>
        <h1 style={{ marginTop: 0 }}><BookOpen size={20} style={{ verticalAlign: "middle", marginRight: 6 }} />{book?.name_ko} {chapter}장</h1>
        {loading ? <p>본문을 불러오는 중입니다.</p> : verses.map((row) => <p key={`${row.chapter}-${row.verse}`} style={{ lineHeight: 1.9, margin: "0 0 10px" }}><b style={{ color: "var(--accent)", marginRight: 8 }}>{row.endVerse ? `${row.verse}-${row.endVerse}` : row.verse}</b>{row.text}</p>)}
        <BibleAttribution version={version} />
      </article>
    </div>
  </main>;
}

const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 16 };
const select: CSSProperties = { minHeight: 42, flex: "1 1 150px", borderRadius: 9, border: "1px solid var(--line)", padding: "0 10px", background: "var(--card)", color: "var(--ink)" };
const button: CSSProperties = { minHeight: 42, border: 0, borderRadius: 9, padding: "0 14px", background: "var(--accent)", color: "white", display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 };
const iconButton: CSSProperties = { border: 0, background: "transparent", color: "var(--ink)", padding: 8 };
