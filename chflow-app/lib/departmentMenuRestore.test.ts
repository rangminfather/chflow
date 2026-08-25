import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../app/departments/d/[id]/page.tsx"), "utf8");

describe("부서 행정관리 탭 복원", () => {
  it("서버의 탭 순서를 불러온 뒤 복원된 활성 탭을 첫 탭으로 덮어쓰지 않는다", () => {
    const orderLoadStart = source.indexOf("if (!sectionOrderResp.error");
    const nextResponseBlock = source.indexOf("if (!sectionLabelsResp.error", orderLoadStart);
    const orderLoadBlock = source.slice(orderLoadStart, nextResponseBlock);

    expect(orderLoadStart).toBeGreaterThan(-1);
    expect(nextResponseBlock).toBeGreaterThan(orderLoadStart);
    expect(orderLoadBlock).toContain("setSectionOrder");
    expect(orderLoadBlock).not.toContain("setActiveAdminSection");
  });
});
