import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-codex-logs/**",
    "../outputs/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/pdf.worker.min.mjs",
    "saved-variants/**",
  ]),
  {
    rules: {
      // 다크모드 가독성 가드 — style 객체의 background 에 흰색 하드코딩 금지.
      // 흰 배경 + var(--ink) 계열 글자는 다크모드에서 읽을 수 없게 된다.
      // 대신 var(--card), 반투명은 color-mix(in srgb, var(--card) X%, transparent),
      // 진짜 흰 종이가 필요한 표면(캔버스/인쇄)은 var(--paper) 사용.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Property[key.name=/^(background|backgroundColor)$/] Literal[value=/^(#fff|#FFF|#ffffff|#FFFFFF|white|White|WHITE)$/]",
          message:
            "background 흰색 하드코딩은 다크모드를 깨뜨립니다 — var(--card) (반투명: color-mix(in srgb, var(--card) X%, transparent), 항상 흰 표면: var(--paper))를 사용하세요.",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "jsx-a11y/alt-text": "warn",
      "react/no-unescaped-entities": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    // 레거시 라이트 전용 목업 — 배경·글자 모두 하드코딩이라 다크모드 깨짐 없음. 새 코드는 예외 금지.
    files: ["app/dashboard/page.jsx"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
]);

export default eslintConfig;
