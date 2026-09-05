import { describe, it, expect } from "vitest";
import { normText, parseDeptBulletinFields } from "./dept-bulletin-fields";

// 2026-09-06 초등1부 주보에서 실제로 뽑은 글자 (공백 정리 전 원문 형태)
const REAL_2026_09_06 = `주일예배순서
사회 다 같 이
안내 : 1-2반 황선영 선생님
찬양 신예슬 최성현 선생님
예배인도 촤성헌 부장 선생님
십계명 ────────────────── 다 같 이
사도신경 ────────────────── 다 같 이
주제제창 하나님의 안경으로 세상을 바라보는 어린이 다 같 이
찬양/헌금 ──── 고백하며 드립니다 ──── 다 같 이
기도 ────────────────── 김정권장로님
성경봉독 ─ 사무엘상 31장 3~5절 ─ 인도자
강론 우리의 생명은 누구의 것인가요? 김희숙전도사님
주기도문 ────────────────── 다 같 이
광고 ────────────────── 총무선생님
✿2부행사 : 28과 공과공부
✿다음주기도 : 1-2반`;

describe("초등1부 주보 예배순서 추출", () => {
  const fields = parseDeptBulletinFields(normText(REAL_2026_09_06));

  it("성경 본문을 뽑는다", () => {
    expect(fields.scripture).toBe("사무엘상31장3~5절");
  });

  it("설교 제목과 강론자를 나눠 뽑는다", () => {
    expect(fields.sermonTitle).toBe("우리의생명은누구의것인가요?");
    expect(fields.preacher).toBe("김희숙전도사님");
  });

  it("안내·찬양·예배인도·봉헌기도를 뽑는다", () => {
    expect(fields.guide).toBe("1-2반황선영선생님");
    expect(fields.praise).toContain("신예슬");
    expect(fields.leader).toContain("부장");
    expect(fields.prayer).toBe("김정권장로님");
  });

  it("2부 활동을 뽑는다", () => {
    expect(fields.twoPartActivity).toBe("28과공과공부");
  });

  it("공백은 미리 없애야 라벨을 찾는다 (원문 그대로는 못 찾음)", () => {
    const raw = parseDeptBulletinFields(REAL_2026_09_06);
    expect(raw.scripture).not.toBe("사무엘상31장3~5절");
  });

  it("주보 형식이 아니면 빈 값으로 돌려준다 (화면이 죽지 않게)", () => {
    const empty = parseDeptBulletinFields(normText("아무 관계 없는 글"));
    expect(empty.scripture).toBe("");
    expect(empty.sermonTitle).toBe("");
  });
});
