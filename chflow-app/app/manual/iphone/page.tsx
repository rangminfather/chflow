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

type Step = {
  n: number;
  title: React.ReactNode;
  glyph?: React.ReactNode;
  lines: React.ReactNode[];
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
  },
  {
    n: 4,
    title: "‘홈 화면에 추가’를 누릅니다",
    glyph: <AddToHomeGlyph />,
    lines: [
      <><b>사각형 안에 +</b> 가 있는 항목입니다.</>,
      <>목록 아래쪽에 있으므로, 목록을 <b>한두 번 위로 밀어 올려야</b> 보입니다.</>,
    ],
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
