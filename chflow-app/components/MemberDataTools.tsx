"use client";
import { useState } from "react";
import { Workbook, type Worksheet } from "exceljs";
import { supabase } from "@/lib/supabase";
import ModalBackdrop from "./ModalBackdrop";
import { Download, Upload, Paperclip, AlertTriangle } from "lucide-react";

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

type RowValue = string | number | boolean | Date | null | undefined;
type DataRow = Record<string, RowValue>;
type DiffChange = Record<string, [RowValue, RowValue]>;

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

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
      const hMap = new Map(((hh.data || []) as DataRow[]).map((r) => [r.id, r]));
      const pMap = new Map(((pa.data || []) as DataRow[]).map((r) => [r.id, r]));
      const gMap = new Map(((gr.data || []) as DataRow[]).map((r) => [r.id, r]));
      const plMap = new Map(((pl.data || []) as DataRow[]).map((r) => [r.id, r]));

      let relations: DataRow[] = [];
      if (sel.Relations) {
        setProgress("가족관계 가져오는 중...");
        const { data } = await supabase.from("member_relations").select("*");
        relations = (data || []) as DataRow[];
      }
      let ministries: DataRow[] = [];
      if (sel.Ministries) {
        setProgress("직분/사역 가져오는 중...");
        const { data } = await supabase.from("member_ministries").select("*");
        ministries = (data || []) as DataRow[];
      }

      setProgress("엑셀 생성 중...");
      const wb = new Workbook();

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
      const wsR = wb.addWorksheet("_README");
      wsR.getColumn(1).width = 90;
      for (const row of readme) wsR.addRow(row);

      // Members
      if (sel.Members) {
        const rows = members
          .slice()
          .sort((a: DataRow, b: DataRow) => Number(a.excel_row_no || 99999) - Number(b.excel_row_no || 99999) || String(a.name || "").localeCompare(String(b.name || "")))
          .map((m: DataRow) => {
            const hh2: DataRow = hMap.get(m.household_id) || {};
            const past: DataRow = pMap.get(hh2.pasture_id) || {};
            const grl: DataRow = gMap.get(past.grassland_id) || {};
            const pln: DataRow = plMap.get(grl.plain_id) || {};
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
        const ws = addJsonSheet(wb, "Members", rows);
        markPkCols(ws, ["id", "household_id", "spouse_id"]);
      }

      // Relations
      if (sel.Relations) {
        const mMap = new Map((members as DataRow[]).map((m) => [m.id, m]));
        const rows = relations
          .map((r) => ({
            id: r.id,
            subject_id: r.subject_id,
            subject_name: mMap.get(r.subject_id)?.name || "",
            relative_id: r.relative_id,
            relative_name: mMap.get(r.relative_id)?.name || "",
            kind: r.kind,
            role: r.role,
          }))
          .sort((a, b) => String(a.subject_name || "").localeCompare(String(b.subject_name || "")) || String(a.kind || "").localeCompare(String(b.kind || "")));
        const ws = addJsonSheet(wb, "Relations", rows);
        markPkCols(ws, ["id", "subject_id", "relative_id"]);
      }

      // Ministries
      if (sel.Ministries) {
        const mMap = new Map((members as DataRow[]).map((m) => [m.id, m]));
        const rows = ministries.map((x) => ({
          id: x.id,
          member_id: x.member_id,
          member_name: mMap.get(x.member_id)?.name || "",
          ministry: x.ministry,
          role: x.role,
          notes: x.notes,
        }));
        const placeholder = [{ id: "", member_id: "", member_name: "", ministry: "", role: "", notes: "" }];
        const ws = addJsonSheet(wb, "Ministries", rows.length ? rows : placeholder);
        markPkCols(ws, ["id", "member_id"]);
      }

      // Directory
      if (sel.Directory) {
        const rows = ((hh.data || []) as DataRow[]).map((h) => {
          const past: DataRow = pMap.get(h.pasture_id) || {};
          const grl: DataRow = gMap.get(past.grassland_id) || {};
          const pln: DataRow = plMap.get(grl.plain_id) || {};
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
        }).sort((a: DataRow, b: DataRow) =>
          String(a.plain_name || "").localeCompare(String(b.plain_name || ""))
          || String(a.grassland_name || "").localeCompare(String(b.grassland_name || ""))
          || String(a.pasture_name || "").localeCompare(String(b.pasture_name || ""))
          || Number(a.order_no || 0) - Number(b.order_no || 0)
        );
        const ws = addJsonSheet(wb, "Directory", rows);
        markPkCols(ws, ["household_id", "pasture_id", "grassland_id", "plain_id"]);
      }

      setProgress("다운로드 중...");
      const fileName = `members_export_${dateStamp()}.xlsx`;
      const buf = await wb.xlsx.writeBuffer();
      triggerDownload(buf, fileName);
      setProgress(`✓ 다운로드 완료: ${fileName}`);
      setTimeout(onClose, 1500);
    } catch (e: unknown) {
      alert("백업 실패: " + errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalBackdrop onClose={onClose} style={modalBg}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modal, maxWidth: 480 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 18, fontWeight: 800, color: "var(--ink)", marginBottom: 6 }}><Download size={20} strokeWidth={1.8} /> 회원정보 백업</div>
        <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 16 }}>
          포함할 데이터를 선택하세요. 엑셀(.xlsx)로 다운로드됩니다.
        </div>

        {SHEET_INFO.map(info => (
          <label key={info.key}
            onClick={() => toggle(info.key, info)}
            style={{
              display: "flex", alignItems: "flex-start", gap: 10, padding: 12,
              borderRadius: 8, marginBottom: 6,
              background: sel[info.key] ? "var(--accent-soft)" : "var(--surface)",
              border: `1.5px solid ${sel[info.key] ? "var(--accent)" : "var(--hairline)"}`,
              cursor: info.required ? "default" : "pointer",
              opacity: info.required ? 0.85 : 1,
            }}>
            <input type="checkbox" checked={sel[info.key]} disabled={info.required} readOnly
              style={{ marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
                {info.label} {info.required && <span style={{ fontSize: 10, color: "var(--danger)", fontWeight: 600 }}>(필수)</span>}
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>{info.desc}</div>
            </div>
          </label>
        ))}

        {progress && (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "var(--bg-soft)", fontSize: 12, color: "var(--ink-mid)" }}>
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
    </ModalBackdrop>
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
  updates: { id: string; name: string; changes: DiffChange; row: DataRow }[];
  inserts: DataRow[];
  deletes: DataRow[];
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
      const wb = new Workbook();
      await wb.xlsx.load(buf);
      const results: DiffResult[] = [];

      for (const sheetName of ["Directory", "Members", "Relations", "Ministries"]) {
        const ws = wb.getWorksheet(sheetName);
        if (!ws) continue;
        const def = SHEET_DEFS[sheetName];
        const rows = wsToJson(ws);
        const excelRows = rows.map(r => normalizeRow(r, def.cols)).filter((r): r is DataRow => Boolean(r));

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
    } catch (e: unknown) {
      alert("분석 실패: " + errorMessage(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const apply = async () => {
    if (!diffs) return;
    setBusy(true);
    const summary: string[] = [];
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
    } catch (e: unknown) {
      alert("적용 실패: " + errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalBackdrop onClose={() => { if (!busy) onClose(); }} style={modalBg}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modal, maxWidth: 720 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 18, fontWeight: 800, color: "var(--ink)", marginBottom: 6 }}><Upload size={20} strokeWidth={1.8} /> 회원정보 일괄업로드</div>

        {step === "select" && (
          <>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 14 }}>
              백업한 엑셀(.xlsx) 파일을 검수 후 업로드합니다. 기존 데이터의 id 컬럼은 매칭에 사용되니 수정 금지.
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>엑셀 파일</label>
              <input type="file" accept=".xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                style={{ ...input, marginTop: 4, padding: 8 }} />
              {file && <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--ink-mid)", marginTop: 4 }}><Paperclip size={13} strokeWidth={1.8} /> {file.name} ({(file.size / 1024).toFixed(1)} KB)</div>}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>업로드 모드</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                <ModeOption value={3} cur={mode} onClick={() => setMode(3)}
                  badge="가장 추천" tone="ok"
                  title="차이 미리보기 → 확인 후 적용"
                  desc="UPDATE + INSERT 만. 엑셀에 없는 행은 삭제 안 함." />
                <ModeOption value={2} cur={mode} onClick={() => setMode(2)}
                  badge="추천 (가장 안전)" tone="info"
                  title="id 일치 행만 UPDATE"
                  desc="신규 추가/삭제 모두 무시. 기존 데이터 수정만." />
                <ModeOption value={1} cur={mode} onClick={() => setMode(1)}
                  badge="비추천" tone="danger"
                  title="전체 덮어쓰기"
                  desc="엑셀에 없는 모든 행을 DB에서 삭제. 사고 위험." />
              </div>
            </div>

            {progress && (
              <div style={{ padding: 10, borderRadius: 8, background: "var(--bg-soft)", fontSize: 12, color: "var(--ink-mid)", marginBottom: 12 }}>
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
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 14 }}>
              모드 <b style={{ color: "var(--accent)" }}>{mode}</b> 으로 아래 변경이 적용됩니다. 검토 후 적용하세요.
            </div>

            <div style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
              {diffs.map(d => {
                const ins = mode === 2 ? 0 : d.inserts.length;
                const del = mode === 1 ? d.deletes.length : 0;
                const total = d.updates.length + ins + del;
                return (
                  <div key={d.sheet} style={{
                    padding: 12, borderRadius: 8, border: "1px solid var(--hairline)",
                    background: total === 0 ? "var(--surface)" : "var(--card)",
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 6 }}>
                      [{d.sheet}] {d.label} <span style={{ fontSize: 11, color: "var(--ink-faint)", fontWeight: 500 }}>({d.table})</span>
                    </div>
                    <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--ink-mid)" }}>
                      <span>변경: <b style={{ color: "var(--accent)" }}>{d.updates.length}</b></span>
                      <span style={{ opacity: mode === 2 ? 0.4 : 1 }}>추가: <b style={{ color: "var(--success)" }}>{ins}</b>{mode === 2 && d.inserts.length > 0 && ` (${d.inserts.length}건 무시)`}</span>
                      <span style={{ opacity: mode === 1 ? 1 : 0.4 }}>삭제: <b style={{ color: "var(--danger)" }}>{del}</b>{mode !== 1 && d.deletes.length > 0 && ` (${d.deletes.length}건 무시)`}</span>
                      <span style={{ color: "var(--ink-faint)" }}>변화없음: {d.unchanged}</span>
                    </div>
                    {d.updates.length > 0 && (
                      <details style={{ marginTop: 6 }}>
                        <summary style={{ fontSize: 11, color: "var(--accent)", cursor: "pointer" }}>변경 미리보기 ({Math.min(10, d.updates.length)}/{d.updates.length})</summary>
                        <ul style={{ marginTop: 4, marginLeft: 16, fontSize: 11, color: "var(--ink-mid)" }}>
                          {d.updates.slice(0, 10).map(u => (
                            <li key={u.id} style={{ marginBottom: 2 }}>
                              <b>{u.name}</b>: {Object.entries(u.changes).map(([k, [a, b]]) =>
                                <span key={k}>{" "}{k}: <s style={{ color: "var(--ink-faint)" }}>{String(a ?? "—")}</s> → <span style={{ color: "var(--success)" }}>{String(b ?? "—")}</span></span>
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
              <div style={{ padding: 10, borderRadius: 8, background: "var(--bg-soft)", fontSize: 12, color: "var(--ink-mid)", marginTop: 12, whiteSpace: "pre-wrap" }}>
                {progress}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button onClick={() => { setStep("select"); setDiffs(null); }} disabled={busy} style={{ ...btnGhost, flex: 1, padding: 12 }}>← 다시 선택</button>
              <button onClick={apply} disabled={busy} style={{
                ...btnPrimary, flex: 1, padding: 12,
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                background: mode === 1 ? "linear-gradient(135deg, var(--danger), var(--danger))" : btnPrimary.background,
              }}>
                {busy ? "적용 중..." : <>{mode === 1 && <AlertTriangle size={14} strokeWidth={1.8} />}적용</>}
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <div style={{ padding: 14, borderRadius: 8, background: "var(--success-soft)", color: "var(--success)", fontSize: 13, fontWeight: 700, marginBottom: 14, whiteSpace: "pre-wrap" }}>
              {progress}
            </div>
            <button onClick={onClose} style={{ ...btnPrimary, width: "100%", padding: 12 }}>닫기</button>
          </>
        )}
      </div>
    </ModalBackdrop>
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
    ok:     { bg: "var(--success-soft)", fg: "var(--success)", brd: "var(--success)" },
    info:   { bg: "var(--accent-soft)", fg: "var(--accent-strong)", brd: "var(--accent)" },
    danger: { bg: "var(--danger-soft)", fg: "var(--danger)", brd: "var(--danger)" },
  }[tone];
  return (
    <label onClick={onClick} style={{
      display: "flex", gap: 10, padding: 10, borderRadius: 8,
      background: active ? colors.bg : "var(--surface)",
      border: `1.5px solid ${active ? colors.brd : "var(--hairline)"}`,
      cursor: "pointer",
    }}>
      <input type="radio" checked={active} readOnly style={{ marginTop: 3 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: colors.fg, marginBottom: 2 }}>모드 {value} · {badge}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{title}</div>
        <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 1 }}>{desc}</div>
      </div>
    </label>
  );
}

function xlCellToValue(v: unknown): RowValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map(r => r.text).join("");
    if ("formula" in v) return ((v as { result?: unknown }).result as RowValue) ?? null;
    if ("hyperlink" in v) return (v as { text?: unknown }).text as RowValue ?? null;
    if ("error" in v) return null;
  }
  return v as RowValue;
}

function wsToJson(ws: Worksheet): DataRow[] {
  const headers: string[] = [];
  const rows: DataRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    const vals = (row.values as unknown[]).slice(1);
    if (rowNum === 1) {
      headers.push(...vals.map(v => String(v ?? "")));
    } else {
      const obj: DataRow = {};
      headers.forEach((h, i) => { obj[h] = xlCellToValue(vals[i]); });
      rows.push(obj);
    }
  });
  return rows;
}

function addJsonSheet(wb: Workbook, name: string, rows: DataRow[]): Worksheet {
  const ws = wb.addWorksheet(name);
  if (rows.length > 0) {
    ws.columns = Object.keys(rows[0]).map(key => ({ header: key, key }));
    ws.addRows(rows);
  }
  return ws;
}

function triggerDownload(buffer: ArrayBuffer | Buffer, fileName: string) {
  const blob = new Blob([new Uint8Array(buffer as ArrayBuffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function markPkCols(ws: Worksheet, cols: string[]) {
  ws.getRow(1).eachCell((cell) => {
    if (cols.includes(String(cell.value))) {
      cell.font = { bold: true, color: { argb: "FF8B4513" } };
    }
  });
}

function dateStamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function normalizeRow(r: DataRow, cols: Record<string, string | null>): DataRow | null {
  const out: DataRow = {};
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

function computeDiff(excelRows: DataRow[], dbRows: DataRow[], pk: string) {
  const dbMap = new Map(dbRows.map(r => [r[pk], r]));
  const excelIds = new Set<string>();
  const updates: { id: string; name: string; changes: DiffChange; row: DataRow }[] = [];
  const inserts: DataRow[] = [];
  let unchanged = 0;

  for (const er of excelRows) {
    const eid = er[pk];
    if (!eid) {
      inserts.push(er);
      continue;
    }
    excelIds.add(String(eid));
    const dr = dbMap.get(eid);
    if (!dr) {
      inserts.push(er);
      continue;
    }
    const changes: DiffChange = {};
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
      updates.push({ id: String(eid), name: String(dr.name || dr.subject_id || dr.member_id || "?"), changes, row: er });
    } else {
      unchanged++;
    }
  }

  const deletes = dbRows.filter(r => !excelIds.has(String(r[pk])));
  return { updates, inserts, deletes, unchanged };
}


// styles
const modalBg: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20,
};
const modal: React.CSSProperties = {
  background: "var(--card)", borderRadius: 16, padding: 24,
  width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto",
};
const input: React.CSSProperties = {
  width: "100%", padding: "10px 12px", fontSize: 13,
  border: "1.5px solid var(--hairline)", borderRadius: 8, outline: "none",
  color: "var(--ink)", boxSizing: "border-box", fontFamily: "inherit", background: "var(--card)",
};
const lbl: React.CSSProperties = { fontSize: 11, color: "var(--ink-mid)", fontWeight: 700 };
const btnPrimary: React.CSSProperties = {
  background: "linear-gradient(135deg, var(--accent), var(--accent-muted))",
  color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
const btnGhost: React.CSSProperties = {
  background: "var(--bg-soft)", border: "none",
  borderRadius: 8, fontSize: 12, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
};
