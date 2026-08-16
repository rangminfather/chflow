"use client";

import { ShieldCheck } from "lucide-react";
import type { DeptClassOption } from "@/lib/deptClassScope";

export default function DeptMasterClassPicker({
  classes,
  value,
  onChange,
}: {
  classes: DeptClassOption[];
  value: string;
  onChange: (classNo: string) => void;
}) {
  return (
    <div
      style={{
        margin: "0 16px 16px",
        padding: "12px 14px",
        border: "1px solid color-mix(in srgb, var(--accent) 28%, var(--hairline))",
        borderRadius: 14,
        background: "var(--accent-soft)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexWrap: "wrap",
        gap: 10,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--accent-strong)", fontSize: 12.5, fontWeight: 800 }}>
        <ShieldCheck size={16} strokeWidth={2} /> 관리자 마스터
      </span>
      {classes.length > 0 ? (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: "var(--ink-mid)" }}>
          점검할 반
          <select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-label="관리자 점검 반 선택"
            style={{
              minWidth: 150,
              height: 38,
              padding: "0 34px 0 12px",
              border: "1px solid var(--hairline-strong)",
              borderRadius: 10,
              background: "var(--card)",
              color: "var(--ink)",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 750,
            }}
          >
            {classes.map((item) => (
              <option key={item.classNo} value={item.classNo}>
                {item.label}{item.teacherName ? ` · ${item.teacherName}` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>등록된 반이 없습니다.</span>
      )}
      <span style={{ width: "100%", textAlign: "center", fontSize: 11.5, color: "var(--ink-soft)" }}>
        부서 직책과 관계없이 각 반의 실제 담임 화면을 점검할 수 있습니다.
      </span>
    </div>
  );
}
