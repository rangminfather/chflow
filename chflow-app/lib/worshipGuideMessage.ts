export type WorshipGuideMessageFallbacks = {
  guide?: string;
  praise?: string;
  leader?: string;
  prayer?: string;
  preacher?: string;
  sermonTitle?: string;
  scripture?: string;
  twoPartActivity?: string;
};

const MISSING_VALUE = "\\(직접 입력\\)";

const MISSING_LINE_PATTERNS: Array<{
  key: keyof WorshipGuideMessageFallbacks;
  pattern: RegExp;
}> = [
  { key: "guide", pattern: new RegExp(`^(1\\.\\s*안내\\s*:\\s*)${MISSING_VALUE}\\s*$`, "m") },
  { key: "praise", pattern: new RegExp(`^(2\\.\\s*찬양율동\\s*:\\s*)${MISSING_VALUE}\\s*$`, "m") },
  { key: "leader", pattern: new RegExp(`^(3\\.\\s*예배인도\\s*:\\s*)${MISSING_VALUE}\\s*$`, "m") },
  { key: "prayer", pattern: new RegExp(`^(4\\.\\s*봉헌기도\\s*:\\s*)${MISSING_VALUE}\\s*$`, "m") },
  { key: "preacher", pattern: new RegExp(`^(5\\.\\s*말씀강론\\s*:\\s*)${MISSING_VALUE}\\s*$`, "m") },
  { key: "sermonTitle", pattern: new RegExp(`^(\\s*가\\.\\s*제목\\s*:\\s*)${MISSING_VALUE}\\s*$`, "m") },
  { key: "scripture", pattern: new RegExp(`^(\\s*나\\.\\s*성경\\s*:\\s*)${MISSING_VALUE}\\s*$`, "m") },
  { key: "twoPartActivity", pattern: new RegExp(`^(\\s*-\\s*)${MISSING_VALUE}\\s*$`, "m") },
];

/**
 * 이미 생성된 예배안내에서 아직 `(직접 입력)`인 항목만 보조 자료 값으로 채운다.
 * 저장된 값이나 사용자가 수정한 문장은 덮어쓰지 않는다.
 */
export function fillMissingWorshipGuideMessage(
  message: string,
  fallbacks: WorshipGuideMessageFallbacks,
) {
  return MISSING_LINE_PATTERNS.reduce((current, { key, pattern }) => {
    const value = fallbacks[key]?.trim();
    if (!value) return current;
    return current.replace(pattern, (_match, prefix: string) => `${prefix}${value}`);
  }, message);
}
