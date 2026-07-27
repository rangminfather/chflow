"use client";

import { useRouter } from "next/navigation";
import { Printer, ArrowLeft } from "lucide-react";

const SITE_HOST = "smartms.kr";

/** iOS '공유' 버튼 글리프 — 위로 화살표가 나온 사각형 */
function ShareGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8.2 5H6.5A2.5 2.5 0 0 0 4 7.5v11A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 17.5 5h-1.7" />
      <path d="M12 15.2V3" />
      <path d="M8.6 6.4 12 3l3.4 3.4" />
    </svg>
  );
}

/** iOS '홈 화면에 추가' 글리프 — 사각형 안에 + */
function AddToHomeGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <path d="M12 8.3v7.4M8.3 12h7.4" />
    </svg>
  );
}

/** 사파리 앱 글리프 — 나침반 */
function SafariGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M16.2 7.8l-2.5 5.9-5.9 2.5 2.5-5.9z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * 그림 1 — 아이폰 사파리 화면 맨 아래 버튼 줄에서 '공유' 버튼 위치.
 * 실제 스크린샷이 아니라 위치를 알려주기 위한 그림입니다.
 * (iOS 버전에 따라 모양은 조금 달라도 버튼 순서·가운데 위치는 같습니다)
 */
function ToolbarFigure() {
  return (
    <svg viewBox="0 0 170 86" className="a4-fig-svg" role="img" aria-label="사파리 화면 맨 아래 버튼 줄의 가운데가 공유 버튼입니다">
      {/* 안내 말풍선 */}
      <rect x="52" y="1" width="66" height="17" rx="8.5" className="fig-accent-fill" />
      <text x="85" y="13.2" textAnchor="middle" className="fig-badge-text">여기!</text>
      <path d="M85 18 v7" className="fig-accent-stroke" />
      <path d="M81.6 22.5 85 26 88.4 22.5" className="fig-accent-stroke" fill="none" />

      {/* 화면 아래쪽 버튼 줄 */}
      <rect x="2" y="31" width="166" height="36" rx="11" className="fig-bar" />

      {/* ‹ 뒤로 */}
      <path d="M22 44 l-6 5 6 5" className="fig-icon" fill="none" />
      {/* › 앞으로 */}
      <path d="M48 44 l6 5 -6 5" className="fig-icon" fill="none" />

      {/* 공유 (가운데) — 강조 */}
      <circle cx="85" cy="49" r="14.5" className="fig-accent-ring" />
      <g transform="translate(85 49)">
        <path d="M-4.6 -3.4 H-6.6 a2.6 2.6 0 0 0 -2.6 2.6 V7 a2.6 2.6 0 0 0 2.6 2.6 H6.6 A2.6 2.6 0 0 0 9.2 7 V-0.8 a2.6 2.6 0 0 0 -2.6 -2.6 H4.6" className="fig-accent-stroke" fill="none" />
        <path d="M0 4.6 V-9.4" className="fig-accent-stroke" fill="none" />
        <path d="M-3.6 -5.8 0 -9.4 3.6 -5.8" className="fig-accent-stroke" fill="none" />
      </g>

      {/* 책(북마크) */}
      <path d="M116 42 h11 v14 h-11 z M116 42 v14" className="fig-icon" fill="none" />
      {/* 탭 */}
      <path d="M141 43 h10 v10 h-10 z M144 46 h10 v10 h-10 z" className="fig-icon" fill="none" />

      <text x="85" y="80" textAnchor="middle" className="fig-caption-text">화면 맨 아래 버튼 줄</text>
    </svg>
  );
}

/**
 * 그림 2 — '공유' 목록에서 '홈 화면에 추가' 항목.
 * 목록 아래쪽에 있어 위로 밀어 올려야 보인다는 점을 표현합니다.
 */
function ShareSheetFigure() {
  return (
    <svg viewBox="0 0 170 86" className="a4-fig-svg" role="img" aria-label="공유 목록을 위로 밀어 올리면 홈 화면에 추가 항목이 나옵니다">
      {/* 목록 패널 */}
      <rect x="2" y="2" width="166" height="66" rx="9" className="fig-bar" />
      {/* 위로 밀기 손잡이 */}
      <path d="M76 8 h18" className="fig-icon" fill="none" />

      {/* 가려진(위쪽) 항목들 */}
      <rect x="12" y="16" width="104" height="6" rx="3" className="fig-dim" />
      <rect x="12" y="27" width="88" height="6" rx="3" className="fig-dim" />

      {/* 강조 항목: 홈 화면에 추가 */}
      <rect x="8" y="38" width="154" height="22" rx="6" className="fig-accent-ring" />
      <g transform="translate(21 49)">
        <rect x="-7" y="-7" width="14" height="14" rx="4" className="fig-accent-stroke" fill="none" />
        <path d="M0 -3.6 V3.6 M-3.6 0 H3.6" className="fig-accent-stroke" fill="none" />
      </g>
      <text x="36" y="52.6" className="fig-row-text">홈 화면에 추가</text>

      <text x="85" y="80" textAnchor="middle" className="fig-caption-text">위로 밀어 올리면 나옵니다</text>
    </svg>
  );
}

type Step = {
  n: number;
  title: React.ReactNode;
  glyph?: React.ReactNode;
  lines: React.ReactNode[];
  figure?: React.ReactNode;
};

const STEPS: Step[] = [
  {
    n: 1,
    title: "‘사파리’ 앱을 엽니다",
    glyph: <SafariGlyph />,
    lines: [
      <>아이폰·아이패드에 처음부터 들어 있는 <b>나침반 모양</b> 앱입니다.</>,
      <>홈 화면에 아이콘을 만들려면 <b>사파리로 하셔야 합니다.</b> 크롬·네이버 앱은 방법이 다릅니다.</>,
    ],
  },
  {
    n: 2,
    title: <>주소창에 <b>{SITE_HOST}</b> 을 입력합니다</>,
    lines: [
      <>주소창은 기종·설정에 따라 <b>화면 맨 아래</b>에 있거나 <b>맨 위</b>에 있습니다.</>,
      <><b>www.{SITE_HOST}</b> 로 입력해도 똑같은 화면이 열립니다.</>,
      <>로그인 화면이 나오면 접속에 성공한 것입니다.</>,
    ],
  },
  {
    n: 3,
    title: "‘공유’ 버튼을 누릅니다",
    glyph: <ShareGlyph />,
    lines: [
      <><b>위로 화살표가 나온 사각형</b> 모양 버튼입니다.</>,
      <><b>아이폰</b> — 화면 <b>아래쪽</b> 버튼 줄의 가운데에 있습니다.</>,
      <><b>아이패드·맥</b> — 화면 <b>위쪽</b> 주소창 옆에 있습니다.</>,
      <>버튼 줄이 안 보이면 화면을 살짝 아래로 끌어내리면 다시 나타납니다.</>,
    ],
    figure: <ToolbarFigure />,
  },
  {
    n: 4,
    title: "‘홈 화면에 추가’를 누릅니다",
    glyph: <AddToHomeGlyph />,
    lines: [
      <><b>사각형 안에 +</b> 가 있는 항목입니다.</>,
      <>목록 아래쪽에 있으므로, 목록을 <b>한두 번 위로 밀어 올려야</b> 보입니다.</>,
    ],
    figure: <ShareSheetFigure />,
  },
  {
    n: 5,
    title: "오른쪽 위 ‘추가’를 누르면 끝입니다",
    lines: [
      <>홈 화면(바탕화면)에 <b>스마트명성</b> 아이콘이 생깁니다.</>,
      <>다음부터는 주소를 입력하지 않고 <b>그 아이콘만 누르면</b> 바로 열립니다.</>,
    ],
  },
];

const NOTES: React.ReactNode[] = [
  <>홈 화면에 추가하지 않아도 됩니다. 사파리에서 <b>{SITE_HOST}</b> 로 접속해 그대로 사용하실 수 있습니다.</>,
  <>아이폰은 <b>잠금화면 알림이 오지 않습니다.</b> 새 소식은 앱 안의 <b>종 모양 아이콘</b>에서 확인해 주세요.</>,
  <>안드로이드 휴대폰은 <b>Play 스토어</b>에서 ‘스마트명성’ 앱을 설치해 사용하시면 됩니다.</>,
  <>iOS 버전에 따라 화면 모양이 조금씩 다를 수 있습니다. 버튼 이름(‘공유’, ‘홈 화면에 추가’, ‘추가’)은 같습니다.</>,
];

export default function IphoneInstallGuidePage() {
  const router = useRouter();

  return (
    <div className="guide-root">
      {/* ════════ 화면용 헤더 (인쇄 시 숨김) ════════ */}
      <header className="screen-only guide-header">
        <button onClick={() => router.push("/manual")} className="guide-back" aria-label="매뉴얼로">
          <ArrowLeft size={16} strokeWidth={1.8} />
          <span>매뉴얼</span>
        </button>
        <div className="guide-header-text">
          <div className="guide-header-title">아이폰에서 시작하기</div>
          <div className="guide-header-sub">A4 한 장 인쇄용 안내</div>
        </div>
        <button onClick={() => window.print()} className="guide-print-btn" aria-label="인쇄">
          <Printer size={16} strokeWidth={1.8} />
          <span>인쇄</span>
        </button>
      </header>

      {/* ════════ 화면 + 인쇄 공용 본문 ════════ */}
      <div className="a4">
        <div className="a4-head">
          <div className="a4-church">명성교회</div>
          <h1 className="a4-title">
            아이폰·아이패드에서
            <br />
            스마트명성 시작하기
          </h1>
          <div className="a4-url">{SITE_HOST}</div>
          <p className="a4-lead">
            아이폰은 앱을 따로 설치하지 않고 <b>인터넷 주소로 접속</b>해서 사용합니다.
            아래 순서대로 하시면 홈 화면에 아이콘이 생겨 앱처럼 쓸 수 있습니다.
          </p>
        </div>

        <ol className="a4-steps">
          {STEPS.map(step => (
            <li key={step.n} className="a4-step">
              <span className="a4-step-num">{step.n}</span>
              <div className="a4-step-body">
                <div className="a4-step-title">
                  <span>{step.title}</span>
                  {step.glyph && <span className="a4-step-glyph">{step.glyph}</span>}
                </div>
                <ul className="a4-step-lines">
                  {step.lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
              {step.figure && <div className="a4-step-fig">{step.figure}</div>}
            </li>
          ))}
        </ol>

        <div className="a4-notes">
          <div className="a4-notes-title">알아두실 점</div>
          <ul>
            {NOTES.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>

        <div className="a4-foot">
          스마트명성 · 잘 안 되실 때는 앱의 ‘불편신고/건의’ 메뉴로 알려주세요
        </div>
      </div>

      <style>{`
        .guide-root {
          min-height: 100vh;
          background: var(--bg-soft);
          font-family: 'Noto Sans KR', sans-serif;
          padding-bottom: 40px;
        }

        /* ── 화면용 헤더 ── */
        .guide-header {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 14px;
          background: var(--card);
          border-bottom: 1px solid var(--hairline);
          position: sticky; top: 0; z-index: 10;
        }
        .guide-header-text { flex: 1; min-width: 0; }
        .guide-header-title { font-size: 15px; font-weight: 700; color: var(--ink); }
        .guide-header-sub { font-size: 11px; color: var(--ink-soft); margin-top: 1px; }
        .guide-back, .guide-print-btn {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 7px 11px; border-radius: 10px;
          font-size: 12px; font-weight: 600; cursor: pointer;
          border: 1px solid var(--hairline-strong);
          background: var(--bg-soft); color: var(--ink-mid);
        }
        .guide-print-btn {
          border-color: transparent;
          background: var(--accent); color: var(--accent-soft);
        }

        /* ── 문서 본문 (화면) ── */
        .a4 {
          max-width: 720px;
          margin: 16px auto;
          padding: 26px 22px 22px;
          background: var(--card);
          border: 1px solid var(--hairline);
          border-radius: var(--radius);
          color: var(--ink);
        }
        .a4-head { text-align: center; padding-bottom: 18px; }
        .a4-church {
          font-size: 12px; font-weight: 600; letter-spacing: 5px;
          color: var(--accent); margin-bottom: 10px;
        }
        .a4-title {
          font-size: 26px; font-weight: 800; line-height: 1.35;
          color: var(--ink); margin: 0 0 14px;
        }
        .a4-url {
          display: inline-block;
          font-size: 20px; font-weight: 800; letter-spacing: 0.5px;
          color: var(--ink);
          border: 2px solid var(--accent);
          border-radius: 10px;
          padding: 7px 20px;
        }
        .a4-lead {
          font-size: 14px; line-height: 1.8; color: var(--ink-mid);
          margin: 14px auto 0; max-width: 34em;
        }

        .a4-steps { list-style: none; margin: 0; padding: 0; }
        .a4-step {
          display: flex; gap: 12px; align-items: flex-start;
          border-top: 1px solid var(--hairline);
          padding: 15px 2px;
        }
        .a4-step-num {
          flex-shrink: 0;
          width: 27px; height: 27px; border-radius: 50%;
          background: var(--accent); color: var(--accent-soft);
          font-size: 14px; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
        }
        .a4-step-body { flex: 1; min-width: 0; }
        .a4-step-title {
          display: flex; align-items: center; gap: 9px;
          font-size: 16px; font-weight: 700; color: var(--ink);
          margin-bottom: 6px;
        }
        .a4-step-glyph {
          display: inline-flex; align-items: center; justify-content: center;
          width: 34px; height: 34px; flex-shrink: 0;
          border: 1.5px solid var(--accent-line); border-radius: 9px;
          color: var(--accent-strong);
        }
        .a4-step-lines { margin: 0; padding-left: 17px; list-style: disc; }
        .a4-step-lines li {
          font-size: 14px; line-height: 1.85; color: var(--ink-mid);
          margin-bottom: 2px;
        }
        .a4-step-lines b, .a4-notes b { color: var(--ink); font-weight: 700; }

        /* ── 버튼 위치 안내 그림 (스크린샷 아님) ── */
        .a4-step-fig { flex-shrink: 0; width: 168px; align-self: center; }
        .a4-fig-svg { width: 100%; height: auto; display: block; }
        .fig-bar {
          fill: var(--bg-soft);
          stroke: var(--hairline-strong); stroke-width: 1;
        }
        .fig-icon { stroke: var(--ink-faint); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
        .fig-dim  { fill: var(--hairline-strong); }
        .fig-accent-ring   { fill: none; stroke: var(--accent); stroke-width: 1.8; }
        .fig-accent-fill   { fill: var(--accent); }
        .fig-accent-stroke { stroke: var(--accent); stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
        .fig-badge-text {
          fill: var(--accent-soft); font-size: 9.5px; font-weight: 700;
          font-family: 'Noto Sans KR', sans-serif;
        }
        .fig-row-text {
          fill: var(--ink); font-size: 10.5px; font-weight: 700;
          font-family: 'Noto Sans KR', sans-serif;
        }
        .fig-caption-text {
          fill: var(--ink-soft); font-size: 8.5px; font-weight: 500;
          font-family: 'Noto Sans KR', sans-serif;
        }

        /* 좁은 화면에서는 그림만 다음 줄로 내림 (번호+본문은 같은 줄 유지).
           본문에 실제 기준폭을 줘야 그림이 첫 줄에 못 들어가고 줄바꿈된다. */
        @media (max-width: 560px) {
          .a4-step { flex-wrap: wrap; }
          .a4-step-body { flex: 1 1 200px; }
          .a4-step-fig { flex: 0 0 100%; max-width: 230px; margin: 9px 0 0 39px; }
        }

        .a4-notes {
          margin-top: 18px;
          background: var(--bg-soft);
          border-radius: 10px;
          padding: 15px 18px;
        }
        .a4-notes-title {
          font-size: 14px; font-weight: 700; color: var(--ink); margin-bottom: 8px;
        }
        .a4-notes ul { margin: 0; padding-left: 17px; list-style: disc; }
        .a4-notes li {
          font-size: 13px; line-height: 1.8; color: var(--ink-mid); margin-bottom: 4px;
        }
        .a4-foot {
          margin-top: 16px; text-align: center;
          font-size: 12px; color: var(--ink-soft);
        }

        @page { size: A4 portrait; margin: 12mm; }

        @media print {
          .screen-only { display: none !important; }

          /* 인쇄물은 다크모드와 무관하게 항상 라이트 톤 고정 (스플래시와 동일 정책) */
          .guide-root, .a4 {
            --ink: #2B2722;
            --ink-mid: #4A4437;
            --ink-soft: #76705F;
            --accent: #3E5A4A;
            --accent-strong: #334F40;
            --accent-soft: #EAEFE8;
            --accent-line: #C9D6CB;
            --hairline: #E5DECB;
            --bg-soft: #F0EBDF;
          }
          html, body, .guide-root {
            background: var(--paper) !important;
          }
          .guide-root {
            padding: 0;
            min-height: 0;
          }
          .a4 {
            max-width: none; margin: 0; padding: 0;
            background: var(--paper);
            border: none; border-radius: 0;
            color: var(--ink);
          }

          .a4-head { padding-bottom: 4mm; }
          .a4-church { font-size: 10pt; letter-spacing: 5px; margin-bottom: 2.5mm; }
          .a4-title  { font-size: 19pt; margin-bottom: 3.5mm; }
          .a4-url    { font-size: 15pt; border-width: 1.5pt; padding: 1.8mm 7mm; border-radius: 3mm; }
          .a4-lead   { font-size: 10pt; line-height: 1.6; margin-top: 3.5mm; }

          .a4-step {
            gap: 4mm; padding: 2.9mm 0;
            border-top: 0.4pt solid var(--hairline);
            break-inside: avoid; page-break-inside: avoid;
          }
          .a4-step-num   { width: 6.6mm; height: 6.6mm; font-size: 10.5pt; }
          .a4-step-title { font-size: 12pt; gap: 3mm; margin-bottom: 1.5mm; }
          .a4-step-glyph { width: 8mm; height: 8mm; border-width: 0.5pt; border-radius: 2mm; }
          .a4-step-lines li { font-size: 10pt; line-height: 1.65; margin-bottom: 0; }
          .a4-step-fig { width: 44mm; margin: 0; }

          .a4-notes {
            margin-top: 4mm; padding: 3.2mm 5mm; border-radius: 2mm;
            background: var(--bg-soft);
            break-inside: avoid; page-break-inside: avoid;
          }
          .a4-notes-title { font-size: 11pt; margin-bottom: 2mm; }
          .a4-notes li    { font-size: 9.5pt; line-height: 1.6; margin-bottom: 1mm; }
          .a4-foot { margin-top: 4mm; font-size: 8.5pt; }
        }
      `}</style>
    </div>
  );
}
