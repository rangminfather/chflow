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

/* ── 부서별 주보 서식 ────────────────────────────────────────
   예배순서표의 라벨은 부서마다 다르다. 어떤 라벨과 라벨 사이를 잘라낼지만
   여기 표로 두고, 값 다듬는 방식(담당자 떼기·강론자 분리 등)은 공통으로 쓴다.

   한 항목에 후보를 여러 개 두는 이유: 같은 부서 안에서도 "안내 :" 처럼
   콜론이 붙은 해와 안 붙은 해가 섞여 있어서다. 앞에서부터 먼저 걸리는 걸 쓴다.

   아직 서식을 확인하지 못한 부서는 표에 없다 → 초등1부 서식으로 시도한다.
   (맞지 않으면 빈 값이 나올 뿐 화면이 깨지지는 않는다) */
type LabelPair = [start: string, end: string];

export type DeptBulletinProfile = {
  /** 예배순서표가 시작되는 말. 이 앞은 머리글로 보고 잘라낸다. */
  orderAnchor: string;
  pairs: {
    guide: LabelPair[];
    praise: LabelPair[];
    leader: LabelPair[];
    prayer: LabelPair[];
    scripture: LabelPair[];
    sermon: LabelPair[];
    twoPartActivity: LabelPair[];
    /** 주제는 머리글에 있을 수도 있어 scope 가 아니라 전문에서 찾는다 */
    topic: LabelPair[];
  };
};

const ELEMENTARY1_PROFILE: DeptBulletinProfile = {
  orderAnchor: "주일예배순서",
  pairs: {
    guide: [["안내:", "찬양"], ["안내", "찬양"]],
    praise: [["찬양", "예배인도"]],
    leader: [["예배인도", "십계명"]],
    prayer: [["기도", "성경봉독"]],
    scripture: [["성경봉독", "강론"]],
    sermon: [["강론", "주기도문"]],
    twoPartActivity: [["2부행사:", "다음주기도"], ["2부행사", "다음주기도"]],
    topic: [["주제제창", "찬양/헌금"], ["주제제창", "찬양"]],
  },
};

/** 부서명 -> 서식. 없는 부서는 DEFAULT_BULLETIN_PROFILE 로 떨어진다. */
export const DEPT_BULLETIN_PROFILES: Record<string, DeptBulletinProfile> = {
  "초등1부": ELEMENTARY1_PROFILE,
};

export const DEFAULT_BULLETIN_PROFILE = ELEMENTARY1_PROFILE;

export function bulletinProfileFor(deptKey?: string): DeptBulletinProfile {
  return (deptKey && DEPT_BULLETIN_PROFILES[deptKey]) || DEFAULT_BULLETIN_PROFILE;
}

/** 후보 라벨쌍을 순서대로 시도해 처음 걸리는 값을 쓴다 */
function firstBetween(text: string, pairs: LabelPair[]) {
  for (const [start, end] of pairs) {
    const value = between(text, start, end);
    if (value) return value;
  }
  return "";
}

/**
 * 그 주의 주제 — 주일예배순서의 "주제제창" 칸에 적힌 글이 주제다.
 * 공백을 없앤 글자에서 뽑으면 "하나님의안경으로..." 처럼 다 붙어버리므로
 * 줄이 살아 있는 원문에서 먼저 찾고, 실패할 때만 압축본으로 넘어간다.
 * 주제제창 칸이 없는 주보는 머리글의 "주제 : ..." 를 쓴다.
 */
export function parseBulletinTopic(compact: string, rawText?: string, deptKey?: string) {
  if (rawText) {
    const line =
      rawText.match(/주제제창[\s:：─━_]*([^\n]+)/)?.[1] ||
      rawText.match(/주제\s*[:：]\s*([^\n(]+)/)?.[1];
    const value = line ? stripAssignee(cleanBulletinValue(line)) : "";
    if (value) return value;
  }
  return stripAssignee(firstBetween(compact, bulletinProfileFor(deptKey).pairs.topic));
}

/**
 * 주보 예배순서표에서 값을 뽑는다. deptKey 를 주면 그 부서 서식으로,
 * 없으면 초등1부 서식으로 읽는다.
 * 공백·줄바꿈이 살아 있는 원문(rawText)을 같이 주면 주제처럼 띄어쓰기가
 * 살아 있어야 읽히는 값을 원문 기준으로 뽑는다.
 */
export function parseDeptBulletinFields(text: string, rawText?: string, deptKey?: string): DeptBulletinFields {
  const profile = bulletinProfileFor(deptKey);
  const start = text.indexOf(profile.orderAnchor);
  const scope = start >= 0 ? text.slice(start) : text;
  const sermon = firstBetween(scope, profile.pairs.sermon);
  const preacherMatch = sermon.match(/([가-힣]{2,4}(?:전도사|목사|장로|선교사|권사|집사|교육사)(?:님)?)$/);
  const preacher = preacherMatch?.[1] || "";
  const sermonTitle = preacher ? sermon.slice(0, -preacher.length) : sermon;

  return {
    guide: firstBetween(scope, profile.pairs.guide),
    praise: firstBetween(scope, profile.pairs.praise),
    leader: firstBetween(scope, profile.pairs.leader),
    prayer: firstBetween(scope, profile.pairs.prayer),
    scripture: firstBetween(scope, profile.pairs.scripture).replace(/인도자$/, ""),
    sermonTitle: cleanBulletinValue(sermonTitle),
    preacher: cleanBulletinValue(preacher),
    twoPartActivity: firstBetween(scope, profile.pairs.twoPartActivity),
    // 주제는 머리글(예배순서 앞)에도 있을 수 있어 자른 scope 가 아니라 전문에서 찾는다
    topic: parseBulletinTopic(text, rawText, deptKey),
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
  const scriptureScope = rawText.split(/성경\s*봉독/)[1]?.split(/강론|설교|주기도문|광고/)[0] || "";
  const number = String.raw`\d+\s*(?:(?:장|편|[:：])\s*\d+)?\s*(?:절)?(?:\s*[-~∼～–—]\s*\d+\s*(?:(?:장|편|[:：])\s*\d+)?\s*(?:절)?)?`;
  const book = String.raw`[가-힣]+\s*`;
  const scripture = scriptureScope.match(new RegExp(`${book}${number}(?:\\s*[,，;；·]\\s*(?:${book})?${number})*`))?.[0] || "";
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
