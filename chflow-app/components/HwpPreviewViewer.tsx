"use client";

// 부서 주보 HWP 뷰어 — HWP는 웹에서 원본 그대로 렌더링이 불가능해서
// ① 본문 구조(문단/표)를 서버에서 파싱해 앱 스타일로 "정리해서 보기" (내용 100%)
// ② 파일 내장 첫 페이지 이미지(PrvImage)로 "원본 모양 보기"
// 두 가지를 토글로 제공한다. 원본 파일 다운로드/원문 링크 포함.

import { useEffect, useState } from "react";
import type React from "react";
import { Download, ExternalLink, FileText, Image as ImageIcon } from "lucide-react";

type HwpCell = { c: number; r: number; cs: number; rs: number; b: HwpBlock[] };
type HwpBlock =
  | { t: "p"; x: string }
  | { t: "tbl"; rows: number; cols: number; cells: HwpCell[] };

type Props = {
  // /api/dept-bulletin/file?... (원본 다운로드·hwp-json·hwp-preview 공용 base)
  downloadUrl: string;
  // UMS 게시글 주소
  fallbackUrl: string;
};

function blocksHaveContent(blocks: HwpBlock[]): boolean {
  return blocks.some((b) =>
    b.t === "p" ? b.x.trim() !== "" : b.cells.some((cell) => blocksHaveContent(cell.b)),
  );
}

// 섹션 제목처럼 보이는 셀: 표 전체 폭 병합 + 짧은 한 줄 텍스트
function isHeadingCell(cell: HwpCell, cols: number): boolean {
  if (cell.cs < cols) return false;
  const paras = cell.b.filter((b) => b.t === "p") as Array<{ t: "p"; x: string }>;
  if (paras.length !== 1 || cell.b.length !== 1) return false;
  const text = paras[0].x.trim();
  return text.length > 0 && text.length <= 30 && !text.includes("\n");
}

function ParaView({ text, heading }: { text: string; heading?: boolean }) {
  return (
    <div style={heading ? headingParaStyle : paraStyle}>
      {text}
    </div>
  );
}

function TableView({ block }: { block: Extract<HwpBlock, { t: "tbl" }> }) {
  // 행별 그룹 → 내용 없는 행(간격용 빈 행) 제거. rowspan은 간격 행 병합용이 대부분이라 무시.
  const rowMap = new Map<number, HwpCell[]>();
  for (const cell of block.cells) {
    if (!rowMap.has(cell.r)) rowMap.set(cell.r, []);
    rowMap.get(cell.r)!.push(cell);
  }
  const rows = [...rowMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, cells]) => cells.sort((a, b) => a.c - b.c))
    .filter((cells) => cells.some((cell) => blocksHaveContent(cell.b)));

  if (rows.length === 0) return null;

  return (
    <table style={tableStyle}>
      <tbody>
        {rows.map((cells, ri) => {
          const headingRow = cells.length === 1 && isHeadingCell(cells[0], block.cols);
          return (
            <tr key={ri}>
              {cells.map((cell, ci) => (
                <td
                  key={ci}
                  colSpan={Math.min(cell.cs, block.cols)}
                  style={headingRow ? headingCellStyle : cellStyle}
                >
                  <BlocksView blocks={cell.b} />
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BlocksView({ blocks }: { blocks: HwpBlock[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        b.t === "p" ? (
          b.x.trim() ? <ParaView key={i} text={b.x} /> : null
        ) : (
          <TableView key={i} block={b} />
        ),
      )}
    </>
  );
}

export default function HwpPreviewViewer({ downloadUrl, fallbackUrl }: Props) {
  const [mode, setMode] = useState<"remake" | "original">("remake");
  const [blocks, setBlocks] = useState<HwpBlock[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [imgStatus, setImgStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("loading");
      try {
        const res = await fetch(`${downloadUrl}&as=hwp-json`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok || !json.ok || !Array.isArray(json.blocks)) throw new Error(json.error || "파싱 실패");
        if (!cancelled) {
          setBlocks(json.blocks as HwpBlock[]);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMode("original"); // 리메이크 실패 시 원본 첫면으로 폴백
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [downloadUrl]);

  const topLevel = (blocks || []).filter(
    (b) => b.t === "p" ? b.x.trim() !== "" : blocksHaveContent([b]),
  );

  return (
    <div style={rootStyle}>
      <div style={toolbarStyle}>
        <div style={toggleGroupStyle}>
          <button
            type="button"
            onClick={() => setMode("remake")}
            disabled={status === "error"}
            style={mode === "remake" ? toggleActiveStyle : toggleStyle}
          >
            <FileText size={14} strokeWidth={1.9} />
            <span>정리해서 보기</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("original")}
            style={mode === "original" ? toggleActiveStyle : toggleStyle}
          >
            <ImageIcon size={14} strokeWidth={1.9} />
            <span>원본 모양(첫면)</span>
          </button>
        </div>
      </div>

      <div style={viewerStyle}>
        {mode === "remake" ? (
          status === "loading" ? (
            <div style={overlayStyle}>주보 내용을 읽는 중...</div>
          ) : status === "error" ? (
            <div style={overlayStyle}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>내용을 정리하지 못했습니다</div>
              <div style={{ fontSize: 12 }}>원본 모양 탭이나 파일 다운로드를 이용하세요.</div>
            </div>
          ) : (
            <div style={remakeWrapStyle}>
              {topLevel.map((b, i) => (
                <section key={i} style={sectionCardStyle}>
                  <BlocksView blocks={[b]} />
                </section>
              ))}
            </div>
          )
        ) : (
          <div style={{ position: "relative", minHeight: 200 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${downloadUrl}&as=hwp-preview`}
              alt="주보 첫 페이지 원본 미리보기"
              style={imageStyle}
              onLoad={() => setImgStatus("ready")}
              onError={() => setImgStatus("error")}
            />
            {imgStatus === "loading" && <div style={overlayStyle}>원본 미리보기를 불러오는 중...</div>}
            {imgStatus === "error" && (
              <div style={overlayStyle}>미리보기를 표시하지 못했습니다</div>
            )}
            {imgStatus === "ready" && (
              <div style={imgNoteStyle}>원본 모양은 첫 페이지만 제공됩니다. 전체 내용은 &ldquo;정리해서 보기&rdquo;로 확인하세요.</div>
            )}
          </div>
        )}
      </div>

      <div style={actionRowStyle}>
        <a href={downloadUrl} style={actionButtonStyle}>
          <Download size={16} strokeWidth={1.8} />
          <span>파일 다운로드</span>
        </a>
        <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" style={secondaryButtonStyle}>
          <ExternalLink size={16} strokeWidth={1.8} />
          <span>원문 보기</span>
        </a>
      </div>
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "8px 10px",
  borderBottom: "1px solid var(--hairline)",
  background: "var(--surface)",
};

const toggleGroupStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
  padding: 3,
  borderRadius: 10,
  border: "1px solid var(--hairline)",
  background: "var(--bg-soft)",
};

const toggleStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  minHeight: 32,
  padding: "0 10px",
  borderRadius: 8,
  border: "none",
  background: "transparent",
  color: "var(--ink-soft)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const toggleActiveStyle: React.CSSProperties = {
  ...toggleStyle,
  background: "var(--card)",
  color: "var(--ink)",
  boxShadow: "0 1px 4px color-mix(in srgb, var(--ink) 12%, transparent)",
};

const viewerStyle: React.CSSProperties = {
  position: "relative",
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  background: "var(--bg-soft)",
};

const remakeWrapStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 10,
};

const sectionCardStyle: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid var(--hairline)",
  background: "var(--card)",
  padding: "10px 12px",
  overflowX: "auto",
};

const paraStyle: React.CSSProperties = {
  fontSize: 13.5,
  lineHeight: 1.65,
  color: "var(--ink)",
  whiteSpace: "pre-wrap",
  wordBreak: "keep-all",
  overflowWrap: "anywhere",
  padding: "1px 0",
};

const headingParaStyle: React.CSSProperties = {
  ...paraStyle,
  fontSize: 14.5,
  fontWeight: 800,
  color: "var(--accent)",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  margin: "4px 0",
};

const cellStyle: React.CSSProperties = {
  padding: "5px 6px",
  borderBottom: "1px solid var(--hairline)",
  verticalAlign: "top",
};

const headingCellStyle: React.CSSProperties = {
  ...cellStyle,
  background: "color-mix(in srgb, var(--accent) 9%, transparent)",
  borderRadius: 6,
  borderBottom: "none",
};

const imageStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: "auto",
  background: "var(--paper)",
};

const imgNoteStyle: React.CSSProperties = {
  padding: "9px 12px",
  fontSize: 12,
  color: "var(--ink-soft)",
  lineHeight: 1.5,
};

const overlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  background: "var(--surface)",
  color: "var(--ink-soft)",
  fontSize: 13,
  textAlign: "center",
  padding: 16,
};

const actionRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  padding: "10px 12px",
  borderTop: "1px solid var(--hairline)",
  background: "var(--surface)",
};

const actionButtonStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 40,
  padding: "0 14px",
  borderRadius: 10,
  background: "#3E5A4A",
  color: "#FFFDF7",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  fontSize: 13,
  fontWeight: 800,
};

const secondaryButtonStyle: React.CSSProperties = {
  ...actionButtonStyle,
  background: "var(--card)",
  color: "var(--ink)",
  border: "1px solid var(--hairline)",
};
