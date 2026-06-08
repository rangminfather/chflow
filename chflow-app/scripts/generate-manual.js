/**
 * generate-manual.js
 * Playwright 기반 매뉴얼 스크린샷 자동 생성기
 *
 * 실행: node scripts/generate-manual.js
 * 필요: MANUAL_BASE_URL 환경변수 (기본: https://chflow-app.vercel.app)
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const steps = JSON.parse(fs.readFileSync(path.join(__dirname, 'manual-steps.json'), 'utf8'));

const BASE_URL = process.env.MANUAL_BASE_URL || steps.baseUrl;
const OUTPUT_DIR = path.join(__dirname, '..', steps.outputDir);
const REPO_ROOT = path.join(__dirname, '..', '..');
const SUPABASE_DIR = path.join(REPO_ROOT, 'MS_AX', 'chflow-project');
const PW = process.env.MANUAL_TEST_PW || 'Manual2026!';

const ACCOUNTS = {
  manual_admin:   { username: 'manual_admin',   password: PW },
  manual_teacher: { username: 'manual_teacher',  password: PW },
  manual_member:  { username: 'manual_member',   password: PW },
};

// 테스트 전용 가입 계정
const SIGNUP_TEST_USER = 'signupdemotest';
const SIGNUP_TEST_PW   = 'DemoTest2026!';

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

/** Supabase CLI로 SQL 실행 (chflow-project 기준) */
function supabaseQuery(sql) {
  try {
    execSync(`npx -y supabase db query --linked --agent no "${sql.replace(/"/g, '\\"')}"`,
      { stdio: 'pipe', cwd: SUPABASE_DIR });
  } catch (e) {
    // 조용히 무시
  }
}

/** 회원가입 챕터 전용: Playwright로 실제 폼 조작 */
async function captureSignupChapter(page, chapter, manifest) {
  const chId = chapter.id;
  const chTitle = chapter.title;

  const addShot = (stepId, title, desc, shotFile) => {
    manifest.push({ chapterId: chId, chapterTitle: chTitle, stepId, title, desc, shot: shotFile });
  };

  const takeShot = async (stepId, title, desc, selector) => {
    const shotFile = `${stepId}.png`;
    const shotPath = path.join(OUTPUT_DIR, shotFile);
    if (selector) {
      await addHighlight(page, selector);
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: shotPath, fullPage: false });
    if (selector) await removeHighlight(page);
    addShot(stepId, title, desc, shotFile);
    console.log(`    ✓ ${shotFile}`);
  };

  // 기존 테스트 계정 정리 (이전 실행 잔여물)
  supabaseQuery(`DELETE FROM auth.users WHERE email = '${SIGNUP_TEST_USER}@smartms.app'`);

  // signup-01: 로그인 화면 (회원가입 버튼 하이라이트)
  console.log('  [signup-01] 로그인 화면 진입');
  await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await takeShot('signup-01', '로그인 화면 진입',
    '앱(chflow-app.vercel.app)에 접속하면 로그인 화면이 나타납니다. 처음 사용하시는 분은 하단 \'회원가입\' 버튼을 누릅니다.',
    '.login-link-primary');

  // signup-02: 가입 조회 폼 (이름·전화번호 입력 화면 — 입력 전)
  console.log('  [signup-02] 이름·전화번호 조회 폼');
  await page.goto(BASE_URL + '/signup', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await takeShot('signup-02', '이름·전화번호 조회',
    '가입된 성도 명단에서 본인을 찾습니다. 이름과 휴대폰 번호를 입력하고 \'다음\' 버튼을 누릅니다.',
    null);

  // signup-03: 조회 → 정보 확인 화면 (실제 사람이 조회된 화면)
  console.log('  [signup-03] 조회 결과 확인 화면');
  await page.fill('input[placeholder="실명을 입력하세요"]', '매뉴얼테스트');
  await page.fill('input[placeholder="010-0000-0000"]', '01099990001');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  await takeShot('signup-03', '정보 확인 단계',
    '조회된 본인 정보를 확인합니다. 이름, 연락처 등이 일치하면 \'네, 맞습니다\' 버튼을 누릅니다.',
    null);

  // signup-04: 직분 선택 화면
  console.log('  [signup-04] 직분 선택 화면');
  await page.getByRole('button', { name: '네, 맞습니다' }).click();
  await page.waitForTimeout(1000);
  await takeShot('signup-04', '직분 선택',
    '본인의 직분을 선택합니다. 상단 탭으로 분류를 선택한 뒤 해당 직분 카드를 누릅니다.',
    null);

  // signup-05: 아이디·비밀번호 설정 화면 (성도(남) 선택 후)
  console.log('  [signup-05] 아이디·비밀번호 설정 화면');
  // "성도" 탭 클릭 후 "성도 (남)" 카드 선택
  const tabBtns = await page.getByRole('button', { name: '성도' }).all();
  if (tabBtns.length > 0) await tabBtns[0].click();
  await page.waitForTimeout(400);
  await page.getByText('성도 (남)', { exact: true }).first().click();
  await page.waitForTimeout(1000);
  await takeShot('signup-05', '아이디·비밀번호 설정',
    '사용할 아이디(영문 소문자·숫자·_, 4~20자)와 비밀번호(8자 이상)를 입력합니다. 아이디 중복 확인 후 \'가입 완료\' 버튼을 누릅니다.',
    null);

  // signup-06: 가입 완료 화면 (폼 제출 후)
  console.log('  [signup-06] 가입 완료 화면');
  // 아이디 입력 + 중복확인
  await page.fill('input[placeholder="영문 소문자, 숫자, . _ (4~20자)"]', SIGNUP_TEST_USER);
  await page.getByRole('button', { name: '중복확인' }).click();
  await page.waitForTimeout(2000);
  // 비밀번호 입력
  await page.fill('input[placeholder="8자 이상 (문자, 숫자, 기호 조합 권장)"]', SIGNUP_TEST_PW);
  await page.fill('input[placeholder="비밀번호 다시 입력"]', SIGNUP_TEST_PW);
  // 개인정보 동의 체크
  const privacyBox = page.locator('input[type="checkbox"]').first();
  if (!(await privacyBox.isChecked())) await privacyBox.check();
  // 제출
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);
  await takeShot('signup-06', '가입 완료 — 승인 대기',
    '가입 신청이 완료되었습니다. 관리자의 승인 후 로그인이 가능합니다.',
    null);

  // signup-07: 승인 대기 안내 로그인 화면
  console.log('  [signup-07] 승인 대기 로그인 화면');
  await page.goto(BASE_URL + '/login?notice=signup', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await takeShot('signup-07', '승인 대기 안내 화면',
    '가입 완료 후 로그인 화면으로 돌아오면 승인 대기 안내가 표시됩니다. 관리자 승인 후 로그인이 가능합니다.',
    null);

  // 테스트 계정 정리
  supabaseQuery(`DELETE FROM auth.users WHERE email = '${SIGNUP_TEST_USER}@smartms.app'`);
  console.log(`    ✓ 테스트 계정 정리 완료: ${SIGNUP_TEST_USER}`);
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
  const manifest = [];

  for (const chapter of steps.chapters) {
    console.log(`\n=== ${chapter.title} ===`);

    // 회원가입 챕터는 별도 처리
    if (chapter.type === 'signup') {
      await captureSignupChapter(page, chapter, manifest);
      currentAccount = null;
      continue;
    }

    // 계정 전환이 필요하면 로그인
    if (chapter.account && chapter.account !== currentAccount) {
      console.log(`  → 로그인: ${chapter.account}`);
      await doLogin(page, ACCOUNTS[chapter.account]);
      currentAccount = chapter.account;
    } else if (!chapter.account && currentAccount) {
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

  // manifest.json 저장
  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const ok = manifest.filter(m => m.shot).length;
  console.log(`\n✅ 완료! ${ok}/${manifest.length}개 스크린샷 생성`);

  // 자동 git commit + push → Vercel 자동 배포
  const date = new Date().toISOString().slice(0, 10);
  try {
    execSync(`git -C "${REPO_ROOT}" add chflow-app/public/manual/shots/`, { stdio: 'inherit' });
    execSync(`git -C "${REPO_ROOT}" commit -m "Update manual screenshots (${date}, ${ok}장)"`, { stdio: 'inherit' });
    execSync(`git -C "${REPO_ROOT}" push`, { stdio: 'inherit' });
    console.log('🚀 배포 완료 — Vercel 자동 배포 시작됨');
  } catch (e) {
    console.log('ℹ git: 변경 없음 또는 오류 (스킵)');
  }
}

main().catch(err => {
  console.error('스크립트 오류:', err);
  process.exit(1);
});
