export type NkrvVerse = {
  chapter: number;
  verse: number;
  /** Source files occasionally merge adjacent verses into one line. */
  endVerse?: number;
  text: string;
};

export type NkrvBook = {
  version: "NKRV";
  bookId: number;
  verses: NkrvVerse[];
};

export function nkrvBookPath(bookId: number) {
  return `NKRV/${String(bookId).padStart(2, "0")}.json`;
}

export function selectNkrvPassage(
  verses: NkrvVerse[],
  chapterStart: number,
  verseStart: number | null,
  chapterEnd: number | null,
  verseEnd: number | null,
) {
  const endChapter = chapterEnd ?? chapterStart;
  const start = verseStart ?? 1;

  return verses.filter((row) => {
    const rowEnd = row.endVerse ?? row.verse;
    if (row.chapter < chapterStart || row.chapter > endChapter) return false;
    if (row.chapter === chapterStart && rowEnd < start) return false;
    if (row.chapter === endChapter && verseEnd !== null && row.verse > verseEnd) return false;
    return true;
  });
}
