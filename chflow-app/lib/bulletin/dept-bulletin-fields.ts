/* ============================================================
   초등1부 주보에서 예배순서 값 뽑기

   주보 2쪽의 예배순서표는 라벨이 고정돼 있다.
     안내 / 찬양 / 예배인도 / 십계명 … 기도 / 성경봉독 / 강론 / 주기도문 …
   그 라벨 사이에 낀 글자가 실제 값이다. 라벨과 라벨 사이를 잘라내는 방식이라
   서식이 조금 달라져도 웬만하면 버틴다.

   입력 텍스트는 **공백을 모두 없앤 것**을 쓴다(normText). PDF 에서 뽑은 글자는
   칸 사이 공백이 제멋대로라 그대로 두면 라벨을 못 찾는다.

   예배안내·예배인도·부서일지가 같은 주보를 읽으므로 여기 한 곳에 둔다.
   ============================================================ */

export type DeptBulletinFieldKey =
  | "guide"
  | "praise"
  | "leader"
  | "prayer"
  | "scripture"
  | "sermonTitle"
  | "preacher"
  | "twoPartActivity"
  | "topic";

export type DeptBulletinFields = Partial<Record<DeptBulletinFieldKey, string>>;

/** PDF 에서 뽑은 글자는 공백이 제멋대로라 아예 없앤 뒤 라벨을 찾는다 */
export const normText = (value: string) => value.replace(/\s+/g, "");

export function cleanBulletinValue(value: string) {
  return value.replace(/[─━_]+/g, "").replace(/^[✿*:\-：]+|[✿*:\-：]+$/g, "").trim();
}

function between(text: string, start: string, end: string) {
  const from = text.indexOf(start);
  if (from < 0) return "";
  const valueStart = from + start.length;
  const to = text.indexOf(end, valueStart);
  if (to < 0) return "";
  return cleanBulletinValue(text.slice(valueStart, to));
}

/** "다 같 이", "회중", "인도자" 처럼 담당 표기가 값 뒤에 붙어 나오는 것을 떼어낸다 */
function stripAssignee(value: string) {
  return value.replace(/(?:다\s*같\s*이|회중|인도자)\s*$/, "").trim();
}

/**
 * 그 주의 주제 — 주일예배순서의 "주제제창" 칸에 적힌 글이 주제다.
 * 공백을 없앤 글자에서 뽑으면 "하나님의안경으로..." 처럼 다 붙어버리므로
 * 줄이 살아 있는 원문에서 먼저 찾고, 실패할 때만 압축본으로 넘어간다.
 * 주제제창 칸이 없는 주보는 머리글의 "주제 : ..." 를 쓴다.
 */
export function parseBulletinTopic(compact: string, rawText?: string) {
  if (rawText) {
    const line =
      rawText.match(/주제제창[\s:：─━_]*([^\n]+)/)?.[1] ||
      rawText.match(/주제\s*[:：]\s*([^\n(]+)/)?.[1];
    const value = line ? stripAssignee(cleanBulletinValue(line)) : "";
    if (value) return value;
  }
  return (
    stripAssignee(between(compact, "주제제창", "찬양/헌금")) ||
    stripAssignee(between(compact, "주제제창", "찬양"))
  );
}

/**
 * 초등1부 주보 2쪽의 고정된 예배순서 라벨 사이에서 실제 값을 추출한다.
 * 공백·줄바꿈이 살아 있는 원문(rawText)을 같이 주면 주제처럼 띄어쓰기가
 * 살아 있어야 읽히는 값을 원문 기준으로 뽑는다.
 */
export function parseDeptBulletinFields(text: string, rawText?: string): DeptBulletinFields {
  const start = text.indexOf("주일예배순서");
  const scope = start >= 0 ? text.slice(start) : text;
  const sermon = between(scope, "강론", "주기도문");
  const preacherMatch = sermon.match(/([가-힣]{2,4}(?:전도사|목사|장로|선교사|권사|집사|교육사)(?:님)?)$/);
  const preacher = preacherMatch?.[1] || "";
  const sermonTitle = preacher ? sermon.slice(0, -preacher.length) : sermon;

  return {
    guide: between(scope, "안내:", "찬양") || between(scope, "안내", "찬양"),
    praise: between(scope, "찬양", "예배인도"),
    leader: between(scope, "예배인도", "십계명"),
    prayer: between(scope, "기도", "성경봉독"),
    scripture: between(scope, "성경봉독", "강론").replace(/인도자$/, ""),
    sermonTitle: cleanBulletinValue(sermonTitle),
    preacher: cleanBulletinValue(preacher),
    twoPartActivity: between(scope, "2부행사:", "다음주기도") || between(scope, "2부행사", "다음주기도"),
    // 주제는 머리글(예배순서 앞)에도 있을 수 있어 자른 scope 가 아니라 전문에서 찾는다
    topic: parseBulletinTopic(text, rawText),
  };
}

/**
 * Image OCR keeps line boundaries but often drops the fixed labels used by the
 * native-file parser.  Recover the common worship-order values directly from
 * those lines before falling back to the compact-label parser above.
 */
export function parseOcrDeptBulletinFields(rawText: string): DeptBulletinFields {
  const cleanOcrValue = (value: string) => value
    .replace(/[─━—–\-_=.]{2,}/g, " ")
    .replace(/^[\s:：|]+|[\s:：|]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const lineValue = (pattern: RegExp) => {
    const value = rawText.match(pattern)?.[1] || "";
    return cleanOcrValue(value);
  };
  const scripture = rawText.match(/성경봉독\s*([^\n]*?\d+\s*장\s*\d+(?:\s*[~∼\-]\s*\d+)?\s*절)/)?.[1] || "";
  const sermon = rawText.match(/강론\s*([^\n]*?)\s+(김[가-힣]{1,4}(?:(?:전도사|목사|강도사|권사|집사|교육사)님?|선생님))/);

  return {
    leader: lineValue(/안내\s*[:：]?\s*([^\n©@]+)/i),
    praise: lineValue(/(?:^|\n)\s*찬양\s*[-─━—–_=.\s]*([^\n]+)/m),
    scripture: cleanOcrValue(scripture),
    sermonTitle: cleanOcrValue(sermon?.[1] || ""),
    preacher: cleanOcrValue(sermon?.[2] || ""),
    twoPartActivity: lineValue(/행사\s*[:：]\s*([^\n]+)/i),
  };
}
