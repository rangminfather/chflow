"use client";
import { useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

// =============================================================
// 회원정보 백업 모달
// =============================================================
type SheetKey = "Members" | "Relations" | "Ministries" | "Directory";

const SHEET_INFO: { key: SheetKey; label: string; desc: string; required?: boolean; defaultOn: boolean }[] = [
  { key: "Members",    label: "회원 기본정보",  desc: "이름·성별·휴대폰·소속·사진",  required: true,  defaultOn: true  },
  { key: "Relations",  label: "가족관계",       desc: "부모/자녀/배우자",                                defaultOn: true  },
  { key: "Ministries", label: "직분/사역",      desc: "member_ministries",                              defaultOn: false },
  { key: "Directory",  label: "목장 구조",      desc: "평원/초원/목장/가족(주소)",                       defaultOn: false },
];

const KEY_FILL = "8B4513"; // PK 컬럼은 갈색

export function ExportMembersModal({ onClose }: { onClose: () => void }) {
  const [sel, setSel] = useState<Record<SheetKey, boolean>>({
    Members: true, Relations: true, Ministries: false, Directory: false,
  });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  const toggle = (k: SheetKey, info: typeof SHEET_INFO[0]) => {
    if (info.required) return;
    setSel(s => ({ ...s, [k]: !s[k] }));
  };

  const run = async () => {
    setBusy(true);
    try {
      setProgress("회원 데이터 가져오는 중...");
      const { data: members, error: e1 } = await supabase.from("members").select("*");
      if (e1 || !members) throw new Error(e1?.message || "members 조회 실패");

      setProgress("목장 구조 가져오는 중...");
      const [hh, pa, gr, pl] = await Promise.all([
        supabase.from("households").select("*"),
        supabase.from("directory_pastures").select("*"),
        supabase.from("grasslands").select("*"),
        supabase.from("plains").select("*"),
      ]);
      const hMap = new Map((hh.data || []).map((r: any) => [r.id, r]));
      const pMap = new Map((pa.data || []).map((r: any) => [r.id, r]));
      const gMap = new Map((gr.data || []).map((r: any) => [r.id, r]));
      const plMap = new Map((pl.data || []).map((r: any) => [r.id, r]));

      let relations: any[] = [];
      if (sel.Relations) {
        setProgress("가족관계 가져오는 중...");
        const { data } = await supabase.from("member_relations").select("*");
        relations = data || [];
      }
      let ministries: any[] = [];
      if (sel.Ministries) {
        setProgress("직분/사역 가져오는 중...");
        const { data } = await supabase.from("member_ministries").select("*");
        ministries = data || [];
      }

      setProgress("엑셀 생성 중...");
      const wb = XLSX.utils.book_new();

      // _README
      const readme = [
        ["chflow 회원정보 백업"],
        ["생성일시", new Date().toLocaleString("ko-KR")],
        ["포함시트", Object.entries(sel).filter(([_, v]) => v).map(([k]) => k).join(", ")],
        [],
        ["주의사항"],
        ["1. id 컬럼 (갈색 헤더) — 절대 수정/삭제하지 마세요. 업로드 시 매칭 키입니다."],
        ["2. 새 행 추가 시 id 칸은 비워두면 자동 생성됩니다."],
        ["3. plain_name/grassland_name/pasture_name/address 같은 _name 컬럼은 참고용입니다."],
        ["   소속 변경은 household_id 를 다른 값으로 바꿔야 반영됩니다."],
        ["4. 업로드는 회원관리 페이지의 '일괄업로드' 버튼에서 진행하세요."],
      ];
      const wsR = XLSX.utils.aoa_to_sheet(readme);
      wsR["!cols"] = [{ wch: 90 }];
      XLSX.utils.book_append_sheet(wb, wsR, "_README");

      // Members
      if (sel.Members) {
        const rows = members
          .slice()
          .sort((a: any, b: any) => (a.excel_row_no || 99999) - (b.excel_row_no || 99999) || (a.name || "").localeCompare(b.name || ""))
          .map((m: any) => {
            const hh2: any = hMap.get(m.household_id) || {};
            const past: any = pMap.get(hh2.pasture_id) || {};
            const grl: any = gMap.get(past.grassland_id) || {};
            const pln: any = plMap.get(grl.plain_id) || {};
            return {
              id: m.id,
              excel_row_no: m.excel_row_no,
              name: m.name,
              gender: m.gender,
              birth_date: m.birth_date,
              phone: m.phone,
              family_church: m.family_church,
              sub_role: m.sub_role,
              spouse_name: m.spouse_name,
              plain_name: pln.name,
              grassland_name: grl.name,
              pasture_name: past.name,
              address: hh2.address,
              is_child: m.is_child,
              guard_status: m.guard_status,
              has_account: m.app_user_id ? "Y" : "",
              photo_status: m.photo_status,
              photo_page: m.photo_page,
              photo_url: m.photo_url,
              source_page: m.source_page,
              notes: m.notes,
              household_id: m.household_id,
              spouse_id: m.spouse_id,
            };
          });
        const ws = XLSX.utils.json_to_sheet(rows);
        markPkCols(ws, ["id", "household_id", "spouse_id"]);
        XLSX.utils.book_append_sheet(wb, ws, "Members");
      }

      // Relations
      if (sel.Relations) {
        const mMap = new Map(members.map((m: any) => [m.id, m]));
        const rows = relations
          .map((r: any) => ({
            id: r.id,
            subject_id: r.subject_id,
            subject_name: (mMap.get(r.subject_id) as any)?.name || "",
            relative_id: r.relative_id,
            relative_name: (mMap.get(r.relative_id) as any)?.name || "",
            kind: r.kind,
            role: r.role,
          }))
          .sort((a, b) => a.subject_name.localeCompare(b.subject_name) || a.kind.localeCompare(b.kind));
        const ws = XLSX.utils.json_to_sheet(rows);
        markPkCols(ws, ["id", "subject_id", "relative_id"]);
        XLSX.utils.book_append_sheet(wb, ws, "Relations");
      }

      // Ministries
      if (sel.Ministries) {
        const mMap = new Map(members.map((m: any) => [m.id, m]));
        const rows = ministries.map((x: any) => ({
          id: x.id,
          member_id: x.member_id,
          member_name: (mMap.get(x.member_id) as any)?.name || "",
          ministry: x.ministry,
          role: x.role,
          notes: x.notes,
        }));
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ id: "", member_id: "", member_name: "", ministry: "", role: "", notes: "" }]);
        markPkCols(ws, ["id", "member_id"]);
        XLSX.utils.book_append_sheet(wb, ws, "Ministries");
      }

      // Directory
      if (sel.Directory) {
        const rows = (hh.data || []).map((h: any) => {
          const past: any = pMap.get(h.pasture_id) || {};
          const grl: any = gMap.get(past.grassland_id) || {};
          const pln: any = plMap.get(grl.plain_id) || {};
          return {
            household_id: h.id,
            plain_name: pln.name,
            grassland_name: grl.name,
            pasture_name: past.name,
            address: h.address,
            home_phone: h.home_phone,
            order_no: h.order_no,
            pasture_id: past.id,
            grassland_id: grl.id,
            plain_id: pln.id,
          };
        }).sort((a: any, b: any) =>
          (a.plain_name || "").localeCompare(b.plain_name || "")
          || (a.grassland_name || "").localeCompare(b.grassland_name || "")
          || (a.pasture_name || "").localeCompare(b.pasture_name || "")
          || (a.order_no || 0) - (b.order_no || 0)
        );
        const ws = XLSX.utils.json_to_sheet(rows);
        markPkCols(ws, ["household_id", "pasture_id", "grassland_id", "plain_id"]);
        XLSX.utils.book_append_sheet(wb, ws, "Directory");
      }

      setProgress("다운로드 중...");
      const fileName = `members_export_${dateStamp()}.xlsx`;
      XLSX.writeFile(wb, fileName);
      setProgress(`✓ 다운로드 완료: ${fileName}`);
      setTimeout(onClose, 1500);
    } catch (e: any) {
      alert("백업 실패: " + (e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={onClose} style={modalBg}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modal, maxWidth: 480 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", marginBottom: 6 }}>📥 회원정보 백업</div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
          포함할 데이터를 선택하세요. 엑셀(.xlsx)로 다운로드됩니다.
        </div>

        {SHEET_INFO.map(info => (
          <label key={info.key}
            onClick={() => toggle(info.key, info)}
            style={{
              display: "flex", alignItems: "flex-start", gap: 10, padding: 12,
              borderRadius: 8, marginBottom: 6,
              background: sel[info.key] ? "#eef2ff" : "#f8fafc",
              border: `1.5px solid ${sel[info.key] ? "#6366f1" : "#e2e8f0"}`,
              cursor: info.required ? "default" : "pointer",
              opacity: info.required ? 0.85 : 1,
            }}>
            <input type="checkbox" checked={sel[info.key]} disabled={info.required} readOnly
              style={{ marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>
                {info.label} {info.required && <span style={{ fontSize: 10, color: "#dc2626", fontWeight: 600 }}>(필수)</span>}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{info.desc}</div>
            </div>
          </label>
        ))}

        {progress && (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "#f1f5f9", fontSize: 12, color: "#475569" }}>
            {progress}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button onClick={onClose} disabled={busy} style={{ ...btnGhost, flex: 1, padding: 12 }}>닫기</button>
          <button onClick={run} disabled={busy} style={{ ...btnPrimary, flex: 1, padding: 12 }}>
            {busy ? "처리 중..." : "다운로드"}
          </button>
        </div>
      </div>
    </div>
  );
}


// =============================================================
// 일괄 업로드 모달
// =============================================================
type Mode = 1 | 2 | 3;

const SHEET_DEFS: Record<string, {
  table: string;
  cols: Record<string, string | null>;
  pk: string;
  label: string;
}> = {
  Members: {
    table: "members", pk: "id", label: "회원",
    cols: {
      id: "id", excel_row_no: "excel_row_no", name: "name", gender: "gender",
      birth_date: "birth_date", phone: "phone", family_church: "family_church",
      sub_role: "sub_role", spouse_name: "spouse_name",
      plain_name: null, grassland_name: null, pasture_name: null, address: null,
      is_child: "is_child", guard_status: "guard_status", has_account: null,
      photo_status: "photo_status", photo_page: "photo_page", photo_url: "photo_url",
      source_page: "source_page", notes: "notes",
      household_id: "household_id", spouse_id: "spouse_id",
    },
  },
  Relations: {
    table: "member_relations", pk: "id", label: "가족관계",
    cols: {
      id: "id", subject_id: "subject_id", subject_name: null,
      relative_id: "relative_id", relative_name: null,
      kind: "kind", role: "role",
    },
  },
  Ministries: {
    table: "member_ministries", pk: "id", label: "직분/사역",
    cols: {
      id: "id", member_id: "member_id", member_name: null,
      ministry: "ministry", role: "role", notes: "notes",
    },
  },
  Directory: {
    table: "households", pk: "id", label: "목장구조(가족)",
    cols: {
      household_id: "id", plain_name: null, grassland_name: null, pasture_name: null,
      address: "address", home_phone: "home_phone", order_no: "order_no",
      pasture_id: "pasture_id", grassland_id: null, plain_id: null,
    },
  },
};

interface DiffResult {
  sheet: string;
  table: string;
  label: string;
  updates: { id: string; name: string; changes: Record<string, [any, any]>; row: any }[];
  inserts: any[];
  deletes: any[];
  unchanged: number;
}

export function ImportMembersModal({ onClose, onApplied }: { onClose: () => void; onApplied?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>(3);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [diffs, setDiffs] = useState<DiffResult[] | null>(null);
  const [step, setStep] = useState<"select" | "preview" | "done">("select");

  const analyze = async () => {
    if (!file) return;
    setBusy(true);
    setProgress("엑셀 파싱 중...");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      const results: DiffResult[] = [];

      for (const sheetName of ["Directory", "Members", "Relations", "Ministries"]) {
        if (!wb.SheetNames.includes(sheetName)) continue;
        const def = SHEET_DEFS[sheetName];
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: null });
        const excelRows = rows.map(r => normalizeRow(r, def.cols)).filter(r => r);

        setProgress(`[${sheetName}] DB 비교 중...`);
        const { data: dbRows } = await supabase.from(def.table).select("*");
        const diff = computeDiff(excelRows, dbRows || [], def.pk);
        results.push({
          sheet: sheetName, table: def.table, label: def.label,
          ...diff,
        });
      }

      setDiffs(results);
      setStep("preview");
    } catch (e: any) {
      alert("분석 실패: " + (e?.message || String(e)));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const apply = async () => {
    if (!diffs) return;
    setBusy(true);
    let summary: string[] = [];
    try {
      for (const d of diffs) {
        // 적용 대상 결정 (모드별)
        const ups = d.updates;
        const ins = mode === 2 ? [] : d.inserts;
        const dels = mode === 1 ? d.deletes : [];

        if (ups.length === 0 && ins.length === 0 && dels.length === 0) continue;

        setProgress(`[${d.sheet}] 적용 중...`);
        let okU = 0, okI = 0, okD = 0;

        // UPDATE
        for (const u of ups) {
          const body = { ...u.row };
          delete body.id;
          const { error } = await supabase.from(d.table).update(body).eq("id", u.id);
          if (!error) okU++;
        }

        // INSERT (id 비어있는 행)
        if (ins.length) {
          for (let i = 0; i < ins.length; i += 100) {
            const chunk = ins.slice(i, i + 100).map(r => {
              const c = { ...r };
              if (!c.id) delete c.id;
              return c;
            });
            const { error, data } = await supabase.from(d.table).insert(chunk).select();
            if (!error && data) okI += data.length;
          }
        }

        // DELETE
        for (const r of dels) {
          const id = r[SHEET_DEFS[d.sheet].pk];
          if (!id) continue;
          const { error } = await supabase.from(d.table).delete().eq("id", id);
          if (!error) okD++;
        }

        summary.push(`[${d.sheet}] UPDATE ${okU} / INSERT ${okI} / DELETE ${okD}`);
      }

      setProgress("✓ 완료\n\n" + summary.join("\n"));
      setStep("done");
      onApplied?.();
    } catch (e: any) {
      alert("적용 실패: " + (e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={() => !busy && onClose()} style={modalBg}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modal, maxWidth: 720 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", marginBottom: 6 }}>📤 회원정보 일괄업로드</div>

        {step === "select" && (
          <>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
              백업한 엑셀(.xlsx) 파일을 검수 후 업로드합니다. 기존 데이터의 id 컬럼은 매칭에 사용되니 수정 금지.
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>엑셀 파일</label>
              <input type="file" accept=".xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                style={{ ...input, marginTop: 4, padding: 8 }} />
              {file && <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>📎 {file.name} ({(file.size / 1024).toFixed(1)} KB)</div>}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>업로드 모드</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                <ModeOption value={3} cur={mode} onClick={() => setMode(3)}
                  badge="⭐⭐ 가장 추천" tone="ok"
                  title="차이 미리보기 → 확인 후 적용"
                  desc="UPDATE + INSERT 만. 엑셀에 없는 행은 삭제 안 함." />
                <ModeOption value={2} cur={mode} onClick={() => setMode(2)}
                  badge="⭐ 추천 (가장 안전)" tone="info"
                  title="id 일치 행만 UPDATE"
                  desc="신규 추가/삭제 모두 무시. 기존 데이터 수정만." />
                <ModeOption value={1} cur={mode} onClick={() => setMode(1)}
                  badge="⚠️ 비추천" tone="danger"
                  title="전체 덮어쓰기"
                  desc="엑셀에 없는 모든 행을 DB에서 삭제. 사고 위험." />
              </div>
            </div>

            {progress && (
              <div style={{ padding: 10, borderRadius: 8, background: "#f1f5f9", fontSize: 12, color: "#475569", marginBottom: 12 }}>
                {progress}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button onClick={onClose} disabled={busy} style={{ ...btnGhost, flex: 1, padding: 12 }}>취소</button>
              <button onClick={analyze} disabled={!file || busy} style={{ ...btnPrimary, flex: 1, padding: 12 }}>
                {busy ? "분석 중..." : "분석 → 미리보기"}
              </button>
            </div>
          </>
        )}

        {step === "preview" && diffs && (
          <>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
              모드 <b style={{ color: "#6366f1" }}>{mode}</b> 으로 아래 변경이 적용됩니다. 검토 후 적용하세요.
            </div>

            <div style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
              {diffs.map(d => {
                const ins = mode === 2 ? 0 : d.inserts.length;
                const del = mode === 1 ? d.deletes.length : 0;
                const total = d.updates.length + ins + del;
                return (
                  <div key={d.sheet} style={{
                    padding: 12, borderRadius: 8, border: "1px solid #e2e8f0",
                    background: total === 0 ? "#f8fafc" : "#fff",
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", marginBottom: 6 }}>
                      [{d.sheet}] {d.label} <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>({d.table})</span>
                    </div>
                    <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#475569" }}>
                      <span>변경: <b style={{ color: "#6366f1" }}>{d.updates.length}</b></span>
                      <span style={{ opacity: mode === 2 ? 0.4 : 1 }}>추가: <b style={{ color: "#16a34a" }}>{ins}</b>{mode === 2 && d.inserts.length > 0 && ` (${d.inserts.length}건 무시)`}</span>
                      <span style={{ opacity: mode === 1 ? 1 : 0.4 }}>삭제: <b style={{ color: "#dc2626" }}>{del}</b>{mode !== 1 && d.deletes.length > 0 && ` (${d.deletes.length}건 무시)`}</span>
                      <span style={{ color: "#94a3b8" }}>변화없음: {d.unchanged}</span>
                    </div>
                    {d.updates.length > 0 && (
                      <details style={{ marginTop: 6 }}>
                        <summary style={{ fontSize: 11, color: "#6366f1", cursor: "pointer" }}>변경 미리보기 ({Math.min(10, d.updates.length)}/{d.updates.length})</summary>
                        <ul style={{ marginTop: 4, marginLeft: 16, fontSize: 11, color: "#475569" }}>
                          {d.updates.slice(0, 10).map(u => (
                            <li key={u.id} style={{ marginBottom: 2 }}>
                              <b>{u.name}</b>: {Object.entries(u.changes).map(([k, [a, b]]) =>
                                <span key={k}>{" "}{k}: <s style={{ color: "#94a3b8" }}>{String(a ?? "—")}</s> → <span style={{ color: "#16a34a" }}>{String(b ?? "—")}</span></span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>

            {progress && (
              <div style={{ padding: 10, borderRadius: 8, background: "#f1f5f9", fontSize: 12, color: "#475569", marginTop: 12, whiteSpace: "pre-wrap" }}>
                {progress}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button onClick={() => { setStep("select"); setDiffs(null); }} disabled={busy} style={{ ...btnGhost, flex: 1, padding: 12 }}>← 다시 선택</button>
              <button onClick={apply} disabled={busy} style={{
                ...btnPrimary, flex: 1, padding: 12,
                background: mode === 1 ? "linear-gradient(135deg, #dc2626, #b91c1c)" : btnPrimary.background,
              }}>
                {busy ? "적용 중..." : `${mode === 1 ? "⚠️ " : ""}적용`}
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <div style={{ padding: 14, borderRadius: 8, background: "#dcfce7", color: "#15803d", fontSize: 13, fontWeight: 700, marginBottom: 14, whiteSpace: "pre-wrap" }}>
              {progress}
            </div>
            <button onClick={onClose} style={{ ...btnPrimary, width: "100%", padding: 12 }}>닫기</button>
          </>
        )}
      </div>
    </div>
  );
}


// =============================================================
// helpers
// =============================================================
function ModeOption({ value, cur, onClick, badge, tone, title, desc }: {
  value: Mode; cur: Mode; onClick: () => void;
  badge: string; tone: "ok" | "info" | "danger"; title: string; desc: string;
}) {
  const active = value === cur;
  const colors = {
    ok:     { bg: "#dcfce7", fg: "#15803d", brd: "#16a34a" },
    info:   { bg: "#dbeafe", fg: "#1e40af", brd: "#3b82f6" },
    danger: { bg: "#fee2e2", fg: "#991b1b", brd: "#dc2626" },
  }[tone];
  return (
    <label onClick={onClick} style={{
      display: "flex", gap: 10, padding: 10, borderRadius: 8,
      background: active ? colors.bg : "#f8fafc",
      border: `1.5px solid ${active ? colors.brd : "#e2e8f0"}`,
      cursor: "pointer",
    }}>
      <input type="radio" checked={active} readOnly style={{ marginTop: 3 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: colors.fg, marginBottom: 2 }}>모드 {value} · {badge}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{title}</div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>{desc}</div>
      </div>
    </label>
  );
}

function markPkCols(ws: XLSX.WorkSheet, cols: string[]) {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cellAddr = XLSX.utils.encode_cell({ r: 0, c });
    const header = ws[cellAddr];
    if (header && cols.includes(String(header.v))) {
      // 셀 코멘트 추가 — sheetjs 무료판에서는 스타일 미지원이라 코멘트만
      header.c = [{ a: "system", t: "PK — 절대 수정/삭제 금지" }];
    }
  }
}

function dateStamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function normalizeRow(r: any, cols: Record<string, string | null>): any | null {
  const out: any = {};
  let hasAny = false;
  for (const [excelCol, dbCol] of Object.entries(cols)) {
    if (!dbCol) continue;
    let v = r[excelCol];
    if (v === undefined) continue;
    if (typeof v === "string") {
      v = v.trim();
      if (v === "") v = null;
    }
    if (v instanceof Date) {
      // ISO date YYYY-MM-DD
      v = v.toISOString().split("T")[0];
    }
    out[dbCol] = v;
    if (v !== null && v !== undefined && v !== "") hasAny = true;
  }
  return hasAny ? out : null;
}

function computeDiff(excelRows: any[], dbRows: any[], pk: string) {
  const dbMap = new Map(dbRows.map(r => [r[pk], r]));
  const excelIds = new Set<string>();
  const updates: { id: string; name: string; changes: Record<string, [any, any]>; row: any }[] = [];
  const inserts: any[] = [];
  let unchanged = 0;

  for (const er of excelRows) {
    const eid = er[pk];
    if (!eid) {
      inserts.push(er);
      continue;
    }
    excelIds.add(eid);
    const dr: any = dbMap.get(eid);
    if (!dr) {
      inserts.push(er);
      continue;
    }
    const changes: Record<string, [any, any]> = {};
    for (const [k, v] of Object.entries(er)) {
      if (k === pk) continue;
      let dbV = dr[k];
      if (typeof dbV === "string" && dbV.includes("T") && dbV.length > 10 && /^\d{4}-\d{2}-\d{2}T/.test(dbV)) {
        dbV = dbV.split("T")[0];
      }
      const a = (v === undefined || v === "") ? null : v;
      const b = (dbV === undefined || dbV === "") ? null : dbV;
      const eqStr = String(a ?? "") === String(b ?? "");
      if (!eqStr) {
        changes[k] = [b, a];
      }
    }
    if (Object.keys(changes).length > 0) {
      updates.push({ id: eid, name: dr.name || dr.subject_id || dr.member_id || "?", changes, row: er });
    } else {
      unchanged++;
    }
  }

  const deletes = dbRows.filter(r => !excelIds.has(r[pk]));
  return { updates, inserts, deletes, unchanged };
}


// styles
const modalBg: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20,
};
const modal: React.CSSProperties = {
  background: "#fff", borderRadius: 16, padding: 24,
  width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto",
};
const input: React.CSSProperties = {
  width: "100%", padding: "10px 12px", fontSize: 13,
  border: "1.5px solid #e2e8f0", borderRadius: 8, outline: "none",
  color: "#0f172a", boxSizing: "border-box", fontFamily: "inherit", background: "#fff",
};
const lbl: React.CSSProperties = { fontSize: 11, color: "#475569", fontWeight: 700 };
const btnPrimary: React.CSSProperties = {
  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
const btnGhost: React.CSSProperties = {
  background: "#f1f5f9", border: "none",
  borderRadius: 8, fontSize: 12, color: "#475569", cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
};
