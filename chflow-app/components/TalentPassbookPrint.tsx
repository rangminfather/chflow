"use client";

// 잔치용 달란트통장 일괄 출력 오버레이 — A4 세로 한 장에 8매(2×4), 점선 재단선.
// 카드 = 이름·반·총 달란트 + 시장에서 볼펜으로 차감하는 빈 칸.
// 종이 표면이므로 배경은 var(--paper) (다크모드에서도 흰 종이).

import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";

export interface PassbookItem {
  id: string;
  name: string;
  classLabel: string;
  total: number;
}

export default function TalentPassbookPrint({ periodLabel, items, onClose }: {
  periodLabel: string;
  items: PassbookItem[];
  onClose: () => void;
}) {
  return createPortal(
    <div className="talent-print-root">
      <style>{PASSBOOK_PRINT_CSS}</style>

      {/* 화면 전용 툴바 */}
      <div className="talent-print-toolbar">
        <span className="tp-toolbar-info">
          {periodLabel} 달란트통장 {items.length}매 · A4 세로, 한 장에 8매 · 점선대로 잘라 나눠주세요
        </span>
        <button type="button" className="tp-btn tp-btn-primary" onClick={() => window.print()}>
          <Printer size={15} strokeWidth={2.2} /> 인쇄하기
        </button>
        <button type="button" className="tp-btn" onClick={onClose}>
          <X size={15} strokeWidth={2.2} /> 닫기
        </button>
      </div>

      <div className="talent-print-sheet">
        {items.map((item) => (
          <div key={item.id} className="tp-card">
            <div className="tp-card-head">
              <span className="tp-card-title">달란트통장</span>
              <span className="tp-card-period">{periodLabel}</span>
            </div>
            <div className="tp-card-who">
              <span className="tp-card-name">{item.name}</span>
              <span className="tp-card-class">{item.classLabel}</span>
            </div>
            <div className="tp-card-total">
              <span className="tp-card-total-label">모은 달란트</span>
              <span className="tp-card-total-value">{item.total.toLocaleString("ko-KR")}</span>
              <span className="tp-card-total-unit">달란트</span>
            </div>
            <div className="tp-card-use">
              <div className="tp-card-use-label">사용 기록 — 살 때마다 남은 달란트를 볼펜으로 적어요</div>
              <div className="tp-card-cells">
                {Array.from({ length: 8 }).map((_, cellIndex) => <span key={cellIndex} />)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

const PASSBOOK_PRINT_CSS = `
.talent-print-root { position: fixed; inset: 0; z-index: 3000; overflow: auto; background: var(--bg-soft); padding: 14px; font-family: 'Noto Sans KR', sans-serif; }
.talent-print-toolbar { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; max-width: 760px; margin: 0 auto 12px; padding: 10px 14px; border: 1px solid var(--hairline); border-radius: 10px; background: var(--card); }
.tp-toolbar-info { flex: 1; min-width: 200px; font-size: 12px; font-weight: 700; color: var(--ink-soft); }
.tp-btn { display: inline-flex; align-items: center; gap: 5px; min-height: 36px; padding: 0 14px; border: 1px solid var(--hairline); border-radius: 8px; background: var(--bg-soft); color: var(--ink-mid); font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
.tp-btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.talent-print-sheet { display: grid; grid-template-columns: repeat(2, 1fr); max-width: 760px; margin: 0 auto; background: var(--paper); padding: 10px; border-radius: 8px; }
.tp-card { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1.5px dashed #b9ad97; background: var(--paper); color: #2b2722; break-inside: avoid; page-break-inside: avoid; }
.tp-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.tp-card-title { font-size: 13px; font-weight: 800; letter-spacing: 2px; color: #8a6d2f; }
.tp-card-period { font-size: 11px; font-weight: 700; color: #7a746a; }
.tp-card-who { display: flex; align-items: baseline; gap: 8px; border-bottom: 1px solid #d9d2c4; padding-bottom: 5px; }
.tp-card-name { font-size: 19px; font-weight: 800; }
.tp-card-class { font-size: 12px; font-weight: 700; color: #7a746a; }
.tp-card-total { display: flex; align-items: baseline; gap: 6px; }
.tp-card-total-label { font-size: 11px; font-weight: 700; color: #7a746a; }
.tp-card-total-value { margin-left: auto; font-size: 30px; font-weight: 800; line-height: 1; color: #8a6d2f; }
.tp-card-total-unit { font-size: 13px; font-weight: 800; color: #8a6d2f; }
.tp-card-use-label { font-size: 9.5px; font-weight: 600; color: #96907f; margin-bottom: 3px; }
.tp-card-cells { display: grid; grid-template-columns: repeat(4, 1fr); }
.tp-card-cells span { height: 26px; border: 1px solid #d9d2c4; margin: 0 -1px -1px 0; }
@media print {
  @page { size: A4 portrait; margin: 8mm; }
  body > *:not(.talent-print-root) { display: none !important; }
  .talent-print-root { position: static; overflow: visible; background: var(--paper); padding: 0; }
  .talent-print-toolbar { display: none; }
  .talent-print-sheet { display: grid; grid-template-columns: repeat(2, 1fr); max-width: none; padding: 0; border-radius: 0; }
  .tp-card { height: 64mm; box-sizing: border-box; }
}
`;
