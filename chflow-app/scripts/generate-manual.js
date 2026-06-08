/**
 * generate-manual.js
 * Playwright 기반 매뉴얼 스크린샷 자동 생성기
 *
 * 실행: node scripts/generate-manual.js
 * 필요: MANUAL_BASE_URL 환경변수 (기본: https://chflow-app.vercel.app)
 *
 * 계정 정보는 .env.local에 MANUAL_ADMIN_PW 로 저장 (없으면 기본값 사용)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const steps = JSON.parse(fs.readFileSync(path.join(__dirname, 'manual-steps.json'), 'utf8'));

const BASE_URL = process.env.MANUAL_BASE_URL || steps.baseUrl;
const OUTPUT_DIR = path.join(__dirname, '..', steps.outputDir);
const PW = process.env.MANUAL_TEST_PW || 'Manual2026!';

const ACCOUNTS = {
  manual_admin:   { username: 'manual_admin',   password: PW },
  manual_teacher: { username: 'manual_teacher',  password: PW },
  manual_member:  { username: 'manual_member',   password: PW },
};

/** 특정 CSS 셀렉터에 하이라이트 오버레이 추가 */
async function addHighlight(page, selector) {
  if (!selector) return;
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ov = document.createElement('div');
    ov.id = '__manual_highlight__';
    ov.style.cssText = [
      'position:fixed',
      `top:${r.top - 4}px`,
      `left:${r.left - 4}px`,
      `width:${r.width + 8}px`,
      `height:${r.height + 8}px`,
      'border:3px solid #EF4444',
      'border-radius:6px',
      'box-shadow:0 0 0 4px rgba(239,68,68,0.25)',
      'pointer-events:none',
      'z-index:99999',
    ].join(';');
    document.body.appendChild(ov);
  }, selector);
}

async function removeHighlight(page) {
  await page.evaluate(() => {
    document.getElementById('__manual_highlight__')?.remove();
  });
}

/** 로그인 수행 */
async function doLogin(page, account) {
  await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle' });
  await page.fill('#login-username', account.username);
  await page.fill('#login-password', account.password);
  await page.click('.login-submit');
  await page.waitForURL('**/home', { timeout: 15000 });
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },   // iPhone 14 Pro 크기
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();

  let currentAccount = null;

  const manifest = [];   // 나중에 /manual 페이지에서 읽을 메타데이터

  for (const chapter of steps.chapters) {
    console.log(`\n=== ${chapter.title} ===`);

    // 계정 전환이 필요하면 로그인
    if (chapter.account && chapter.account !== currentAccount) {
      console.log(`  → 로그인: ${chapter.account}`);
      await doLogin(page, ACCOUNTS[chapter.account]);
      currentAccount = chapter.account;
    } else if (!chapter.account && currentAccount) {
      // 로그아웃
      await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle' });
      currentAccount = null;
    }

    for (const step of chapter.steps) {
      console.log(`  [${step.id}] ${step.title}`);
      const shotFile = `${step.id}.png`;
      const shotPath = path.join(OUTPUT_DIR, shotFile);

      try {
        if (step.url) {
          await page.goto(BASE_URL + step.url, { waitUntil: 'networkidle', timeout: 20000 });
          // 페이지 안정화 대기
          await page.waitForTimeout(1200);
        }

        if (step.highlight) {
          await addHighlight(page, step.highlight);
          await page.waitForTimeout(300);
        }

        await page.screenshot({ path: shotPath, fullPage: false });

        if (step.highlight) await removeHighlight(page);

        manifest.push({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          stepId: step.id,
          title: step.title,
          desc: step.desc,
          shot: shotFile,
        });
        console.log(`    ✓ 저장: ${shotFile}`);
      } catch (err) {
        console.error(`    ✗ 오류: ${err.message}`);
        manifest.push({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          stepId: step.id,
          title: step.title,
          desc: step.desc,
          shot: null,
          error: err.message,
        });
      }
    }
  }

  await browser.close();

  // manifest.json 저장 (앱 내 /manual 페이지에서 읽음)
  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n✅ 완료! ${manifest.filter(m=>m.shot).length}/${manifest.length}개 스크린샷 생성`);
  console.log(`   출력: ${OUTPUT_DIR}`);
}

main().catch(err => {
  console.error('스크립트 오류:', err);
  process.exit(1);
});
