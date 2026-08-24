import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(resolve(here, "../app/api/manual/pdf/route.ts"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(here, "../package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};

describe("manual PDF runtime", () => {
  it("uses the architecture-specific Chromium 149 pack", () => {
    expect(routeSource).toContain("chromium-v149.0.0-pack.${CHROMIUM_PACK_ARCH}.tar");
    expect(routeSource).not.toContain("chromium-v149.0.0-pack.tar");
  });

  it("catches Chromium download failures and uses headless shell", () => {
    const tryIndex = routeSource.indexOf("try {");
    const executableIndex = routeSource.indexOf("Chromium.executablePath", tryIndex);
    expect(executableIndex).toBeGreaterThan(tryIndex);
    expect(routeSource).toContain('headless: "shell"');
  });

  it("waits for the bundled Korean font before printing", () => {
    const manualSource = readFileSync(resolve(here, "../app/manual/page.tsx"), "utf8");
    expect(routeSource).toContain("await document.fonts.ready");
    expect(manualSource).toContain("font-family: var(--font-noto-sans-kr), sans-serif");
  });

  it("pairs Chromium 149 with its supported Puppeteer release", () => {
    expect(packageJson.dependencies["@sparticuz/chromium-min"]).toBe("^149.0.0");
    expect(packageJson.dependencies["puppeteer-core"]).toBe("25.1.0");
  });
});
