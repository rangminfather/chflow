/* ============================================================
   대한성서공회 성경읽기 딥링크

   [왜 링크인가] 개역개정(NKRV)은 대한성서공회 저작권이 살아 있어서 본문을
   우리 DB·화면에 넣으려면 "컴퓨터성경" 사용 허가가 필요하다. 대신 공회가
   저작권료 없이 허락한 방식이 하나 있다 — 공회 성경읽기·검색 사이트로
   링크하는 것(배너링크). 이 파일은 그 링크 URL만 만든다.

   그래서 여기서 하지 않는 일:
   - 공회 페이지를 서버에서 호출해 본문을 가져오지 않는다 (그건 허가 대상)
   - 우리 화면 안에 iframe/WebView 로 끼워 넣지 않는다 (링크로 인정되는지
     확인 전이다). 항상 새 창/외부 브라우저로 연다.

   문의: 배너링크 02-2103-8841
   ============================================================ */

/** 공회 사이트의 역본 코드 (페이지 역본 선택 값) */
export const BSKOREA_VERSION = {
  개역개정: "GAE",
  개역한글: "HAN",
  표준새번역: "SAE",
  새번역: "SAENEW",
  공동번역: "COG",
} as const;

export type BskoreaVersionCode = (typeof BSKOREA_VERSION)[keyof typeof BSKOREA_VERSION];

/**
 * book_id(1~66) → 공회 사이트 책 코드.
 * bible_books.osis_code 를 소문자로 내린 값과 65권이 일치하고, 요나만 다르다
 * (우리 osis_code 는 JON, 공회는 jnh). 그 한 권만 예외로 둔다.
 */
const BOOK_CODES = [
  "gen", "exo", "lev", "num", "deu", "jos", "jdg", "rut", "1sa", "2sa",
  "1ki", "2ki", "1ch", "2ch", "ezr", "neh", "est", "job", "psa", "pro",
  "ecc", "sng", "isa", "jer", "lam", "ezk", "dan", "hos", "jol", "amo",
  "oba", "jnh", "mic", "nam", "hab", "zep", "hag", "zec", "mal", "mat",
  "mrk", "luk", "jhn", "act", "rom", "1co", "2co", "gal", "eph", "php",
  "col", "1th", "2th", "1ti", "2ti", "tit", "phm", "heb", "jas", "1pe",
  "2pe", "1jn", "2jn", "3jn", "jud", "rev",
] as const;

const READ_PAGE = "https://www.bskorea.or.kr/bible/korbibReadpage.php";

export type BibleRefTarget = {
  bookId: number;
  chapter: number;
  /** 없으면 장 첫머리로 보낸다 */
  verse?: number;
};

/** book_id 가 범위를 벗어나면 null — 호출부는 버튼을 감춘다 */
export function bskoreaBookCode(bookId: number): string | null {
  if (!Number.isInteger(bookId) || bookId < 1 || bookId > BOOK_CODES.length) return null;
  return BOOK_CODES[bookId - 1];
}

/**
 * 공회 성경읽기 페이지 URL. 만들 수 없으면 null.
 * 역본은 호출부가 정한다 — 코드에서 특정 역본을 강제하지 않는다.
 */
export function bskoreaReadUrl(
  target: BibleRefTarget | null | undefined,
  version: BskoreaVersionCode,
): string | null {
  if (!target) return null;
  const book = bskoreaBookCode(target.bookId);
  if (!book) return null;
  const chapter = Number(target.chapter);
  if (!Number.isInteger(chapter) || chapter < 1) return null;
  const params = new URLSearchParams({ version, book, chap: String(chapter) });
  const verse = Number(target.verse);
  if (Number.isInteger(verse) && verse >= 1) params.set("sec", String(verse));
  return `${READ_PAGE}?${params.toString()}`;
}
