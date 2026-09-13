"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Workbook } from "exceljs";

type Sheet = { name: string; rows: string[][] };

export default function ExcelCanvasViewer({ url, fallbackUrl }: { url: string; fallbackUrl: string }) {
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("file_download_failed");
        const workbook = new Workbook();
        await workbook.xlsx.load(await response.arrayBuffer());
        const next = workbook.worksheets.map((worksheet) => {
          const rows: string[][] = [];
          worksheet.eachRow({ includeEmpty: false }, (row) => {
            if (rows.length >= 200) return;
            rows.push(Array.from({ length: Math.min(row.cellCount, 30) }, (_, index) => row.getCell(index + 1).text));
          });
          return { name: worksheet.name, rows };
        });
        if (!cancelled) { setSheets(next); setSelected(0); }
      } catch {
        if (!cancelled) setError("엑셀 주보를 표시하지 못했습니다.");
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (error) return <ViewerFallback message={error} fallbackUrl={fallbackUrl} />;
  const sheet = sheets[selected];
  if (!sheet) return <div style={{ padding: 24, textAlign: "center", color: "var(--ink-soft)" }}>엑셀 주보를 여는 중...</div>;
  const columnCount = Math.max(1, ...sheet.rows.map((row) => row.length));
  return <div style={{ padding: 12 }}>
    {sheets.length > 1 && <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 10 }}>
      {sheets.map((item, index) => <button key={item.name} onClick={() => setSelected(index)} style={{ whiteSpace: "nowrap", padding: "6px 10px", borderRadius: 7, border: 0, background: index === selected ? "var(--accent)" : "var(--bg-soft)", color: index === selected ? "white" : "var(--ink)" }}>{item.name}</button>)}
    </div>}
    <div style={{ overflow: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: "100%" }}><tbody>
        {sheet.rows.map((row, rowIndex) => <tr key={rowIndex}>{Array.from({ length: columnCount }, (_, columnIndex) => <td key={columnIndex} style={{ whiteSpace: "pre-wrap", minWidth: 72, padding: "7px 9px", borderRight: "1px solid var(--line)", borderBottom: "1px solid var(--line)", background: rowIndex === 0 ? "var(--bg-soft)" : "white", fontWeight: rowIndex === 0 ? 700 : 400 }}>{row[columnIndex] || ""}</td>)}</tr>)}
      </tbody></table>
    </div>
    {sheet.rows.length >= 200 && <p style={{ fontSize: 12, color: "var(--ink-soft)" }}>미리보기는 처음 200행까지 표시합니다.</p>}
  </div>;
}

function ViewerFallback({ message, fallbackUrl }: { message: string; fallbackUrl: string }) {
  return <div style={{ padding: 24, textAlign: "center", color: "var(--ink-soft)" }}><p>{message}</p><a href={fallbackUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--accent)" }}><ExternalLink size={15} /> 원문 열기</a></div>;
}
