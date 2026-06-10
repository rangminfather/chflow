"use client";

import {
  Baby, School, GraduationCap, Users, Music, BookOpen, Globe, Heart, HeartHandshake, Folder,
} from "lucide-react";
import { createElement, type CSSProperties } from "react";

/* ============================================================
   부서 아이콘 — DB departments.icon(이모지)은 무시하고
   부서명/카테고리 키워드 기반 lucide 아이콘으로 통일 렌더.
   ============================================================ */

function pickIcon(label: string) {
  if (/영아|유아|유치/.test(label)) return Baby;
  if (/초등/.test(label)) return School;
  if (/중등|고등|중고등|청소년|학생/.test(label)) return GraduationCap;
  if (/청년|대학|장년|남선교|여선교/.test(label)) return Users;
  if (/찬양|성가|워십|악기|미디어|방송/.test(label)) return Music;
  if (/교육|훈련|양육|성경|말씀/.test(label)) return BookOpen;
  if (/선교|전도|해외/.test(label)) return Globe;
  if (/봉사|섬김|구제|복지/.test(label)) return HeartHandshake;
  if (/사랑|심방|돌봄/.test(label)) return Heart;
  return Folder;
}

export default function DeptIcon({
  name,
  category,
  size = 20,
  color = "var(--accent)",
  style,
}: {
  name?: string | null;
  category?: string | null;
  size?: number;
  color?: string;
  style?: CSSProperties;
}) {
  return createElement(pickIcon(`${category || ""} ${name || ""}`), {
    size,
    strokeWidth: 1.8,
    style: { color, flexShrink: 0, ...style },
  });
}
