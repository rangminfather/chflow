import { describe, expect, it } from "vitest";
import { normalizeCourseName, normalizeDate, normalizePersonName } from "./normalize";

describe("education normalization", () => {
  it("이름의 직분과 괄호 식별자를 보존한다", () => {
    expect(normalizePersonName("김순희(장)집사")).toMatchObject({
      personNameNormalized: "김순희",
      historicalRoleRaw: "집사",
      disambiguatorRaw: "장",
    });
    expect(normalizePersonName("정  훈집사")).toMatchObject({
      personNameNormalized: "정훈",
      historicalRoleRaw: "집사",
    });
  });

  it("과정명에서 기수·반·대상을 분리한다", () => {
    expect(normalizeCourseName("제3기생명의삶B")).toMatchObject({
      standardCourseName: "생명의삶", cohortNo: 3, classVariant: "B",
      audience: "adult", requirementType: "basic_required",
    });
    expect(normalizeCourseName("제5기어린이생명의삶")).toMatchObject({
      standardCourseName: "생명의삶", cohortNo: 5, audience: "child",
      requirementType: "not_applicable",
    });
  });

  it("LMTC 기수 범위를 임의의 단일 기수로 바꾸지 않는다", () => {
    expect(normalizeCourseName("울산LMTC3기-5기", "lmtc_history")).toMatchObject({
      cohortNo: null, cohortFrom: 3, cohortTo: 5, cohortPrecision: "range",
    });
  });

  it("날짜 형식과 신청·수료·이수를 구분한다", () => {
    expect(normalizeDate("2004.02.29", "", "general_education_history")).toMatchObject({
      completedOn: "2004-02-29", datePrecision: "day", attendanceStatus: "completed",
    });
    expect(normalizeDate("11년9월강의", "", "general_education_history")).toMatchObject({
      completedOn: "2011-09-01", datePrecision: "month", dateParseStatus: "partial",
    });
    expect(normalizeDate("2013.09.신청", "", "general_education_history")).toMatchObject({
      completedOn: null, attendanceStatus: "applied",
    });
    expect(normalizeDate("2020년6/13일-9/19강의", "이수", "lmtc_history")).toMatchObject({
      startedOn: "2020-06-13", endedOn: "2020-09-19", attendanceStatus: "attended",
    });
  });
});
