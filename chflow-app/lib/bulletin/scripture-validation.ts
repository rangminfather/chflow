import { r2 } from "../r2";
import { nkrvBookPath, type NkrvBook } from "../bible/nkrvR2";

type RpcClient = { rpc: (...args: any[]) => any };

export type ValidatedReference = {
  bookId: number;
  chapterStart: number;
  verseStart: number;
  chapterEnd: number;
  verseEnd: number;
  normalizedLabel: string;
};

type Parsed = {
  book_id: number; chapter_start: number; verse_start: number | null;
  chapter_end: number | null; verse_end: number | null; normalized_label: string;
};

/** DB aliases parse the reference; R2 is then checked for every requested verse. */
export async function validateNkrvReference(client: RpcClient, reference: string): Promise<ValidatedReference> {
  if (/\d\s*[:\-]\s*[IlOo]/.test(reference) || /[IlOo]\s*\d/.test(reference)) {
    throw new Error("OCR 숫자 오인식 가능성이 있어 확인이 필요합니다.");
  }
  const { data, error } = await client.rpc("parse_bible_reference", { p_ref: reference });
  const parsed = Array.isArray(data) ? data[0] as Parsed | undefined : undefined;
  if (error || !parsed || parsed.verse_start == null || parsed.verse_end == null) {
    throw new Error("단일 성경 구절 범위를 해석할 수 없습니다.");
  }
  const chapterStart = Number(parsed.chapter_start);
  const chapterEnd = Number(parsed.chapter_end ?? parsed.chapter_start);
  const verseStart = Number(parsed.verse_start);
  const verseEnd = Number(parsed.verse_end);
  if (chapterStart > chapterEnd || (chapterStart === chapterEnd && verseStart > verseEnd)) {
    throw new Error("성경 구절의 시작과 끝 순서가 올바르지 않습니다.");
  }
  const { data: object, error: objectError } = await r2.from("bible").getObject(nkrvBookPath(Number(parsed.book_id)));
  if (objectError || !object) throw new Error("NKRV 본문 데이터를 불러오지 못했습니다.");
  const book = JSON.parse(object.body.toString("utf8")) as NkrvBook;
  if (book.version !== "NKRV" || book.bookId !== Number(parsed.book_id)) throw new Error("NKRV 본문 데이터가 올바르지 않습니다.");
  for (let chapter = chapterStart; chapter <= chapterEnd; chapter += 1) {
    const from = chapter === chapterStart ? verseStart : 1;
    const chapterRows = book.verses.filter((row) => row.chapter === chapter);
    const to = chapter === chapterEnd ? verseEnd : Math.max(...chapterRows.map((row) => row.endVerse ?? row.verse));
    if (!chapterRows.length || to < from || !Array.from({ length: to - from + 1 }, (_, i) => from + i).every((verse) => chapterRows.some((row) => row.verse <= verse && (row.endVerse ?? row.verse) >= verse))) {
      throw new Error("NKRV에 존재하지 않는 장 또는 절입니다.");
    }
  }
  return { bookId: Number(parsed.book_id), chapterStart, verseStart, chapterEnd, verseEnd, normalizedLabel: parsed.normalized_label };
}
