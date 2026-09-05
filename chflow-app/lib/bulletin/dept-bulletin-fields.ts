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
  | "twoPartActivity";

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

/** 초등1부 주보 2쪽의 고정된 예배순서 라벨 사이에서 실제 값을 추출한다. */
export function parseDeptBulletinFields(text: string): DeptBulletinFields {
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
  };
}
