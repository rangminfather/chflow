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

/** .env.local 에서 Supabase 접속 정보 로드 */
function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/** 가입 테스트 계정 삭제 (Supabase Admin API) */
async function deleteSignupTestUser() {
  const env = loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('    ℹ SUPABASE_SERVICE_ROLE_KEY 없음 — 테스트 계정 정리 건너뜀');
    return;
  }
  const { createClient } = require('@supabase/supabase-js');
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${SIGNUP_TEST_USER}@smartms.app`;
  for (let pageNo = 1; pageNo <= 20; pageNo++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pageNo, perPage: 1000 });
    if (error || !data?.users?.length) return;
    const u = data.users.find(x => x.email === email);
    if (u) {
      // admin_reject_signup(p_delete=true)와 동일 절차:
      // members 연결 해제 → 가입 알림 정리 → auth user 삭제 (profiles는 CASCADE)
      await admin.from('members')
        .update({ app_user_id: null, guard_status: '비회원' })
        .eq('app_user_id', u.id);
      await admin.from('notifications').delete().eq('created_by', u.id);
      const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
      console.log(delErr
        ? `    ✗ 테스트 계정 삭제 실패: ${delErr.message}`
        : `    ✓ 테스트 계정 삭제: ${email}`);
      return;
    }
    if (data.users.length < 1000) return;
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
  await deleteSignupTestUser();

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

  // signup-02b: 자녀(어린이) 가입 — 휴대폰 없음 체크 시 보호자 입력란
  console.log('  [signup-02b] 자녀 가입 — 보호자 정보 입력란');
  const noPhoneBox = page.locator('label:has-text("휴대폰 없음") input[type="checkbox"]');
  await noPhoneBox.check();
  await page.waitForTimeout(600);
  await takeShot('signup-02b', '자녀(어린이) 가입 시 — 보호자 정보',
    '휴대폰이 없는 어린이·유아(예: 초등1부 자녀)를 가입시킬 때는 \'휴대폰 없음\' 칸에 체크합니다. 그러면 보호자 이름과 보호자 휴대폰 입력란이 나타납니다. 명성교회에 등록된 부모님(보호자)의 이름과 휴대폰 번호를 입력하면 자녀를 명단에서 찾아 줍니다. 이후 절차는 성인 가입과 같습니다.',
    null);
  await noPhoneBox.uncheck();
  await page.waitForTimeout(400);

  // signup-03: 조회 → 정보 확인 화면 (실제 사람이 조회된 화면)
  console.log('  [signup-03] 조회 결과 확인 화면');
  await page.fill('input[placeholder="실명을 입력해주세요"]', '매뉴얼테스트');
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
  // roleGroup 기본값이 "members"(성도)이므로 탭 클릭 불필요
  // RoleCard는 aria-label 로 식별 (텍스트 노드 없음)
  await page.locator('[aria-label="성도 (남)"]').first().click();
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
  await deleteSignupTestUser();
}

/** 사역·부서 가입 챕터: 가입 모달까지 실제 조작 (신청 제출은 하지 않음) */
async function captureDeptJoinChapter(page, chapter, manifest) {
  const chId = chapter.id;
  const chTitle = chapter.title;

  const takeShot = async (stepId, title, desc) => {
    const shotFile = `${stepId}.png`;
    await page.screenshot({ path: path.join(OUTPUT_DIR, shotFile), fullPage: false });
    manifest.push({ chapterId: chId, chapterTitle: chTitle, stepId, title, desc, shot: shotFile });
    console.log(`    ✓ ${shotFile}`);
  };
  const addError = (stepId, title, desc, err) => {
    manifest.push({ chapterId: chId, chapterTitle: chTitle, stepId, title, desc, shot: null, error: err.message });
    console.error(`    ✗ ${stepId}: ${err.message}`);
  };

  // deptjoin-01: 사역국 대분류
  console.log('  [deptjoin-01] 사역·부서 가입 화면');
  await page.goto(BASE_URL + '/departments', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await takeShot('deptjoin-01', '사역·부서 가입 화면',
    '홈 화면 아래 \'+ 사역·부서 가입\' 버튼을 누르면 이 화면이 나옵니다. 교육사역국, 예배사역국 등 사역국 대분류가 카드로 보입니다. 초등1부는 \'교육사역국\' 안에 있으므로 교육사역국 카드를 누릅니다.');

  // deptjoin-02: 교육사역국 부서 목록
  console.log('  [deptjoin-02] 교육사역국 부서 목록');
  await page.getByText('교육사역국').first().click();
  await page.waitForTimeout(2200);
  await takeShot('deptjoin-02', '교육사역국 부서 목록',
    '교육사역국 안의 부서들이 카드로 나옵니다. 화면을 옆으로 밀면(스와이프) 영아부, 유치부, 초등1부 등 다른 부서가 차례로 보입니다. 카드에는 부서 이름, 대표·부장·총무·담임 사진, 활동 인원이 표시됩니다. 가입할 부서(예: 초등1부) 카드를 누릅니다. 이미 가입된 부서는 \'가입됨\'으로 표시됩니다.');

  // deptjoin-03~05: 가입 모달 (가입 안 된 부서 카드에서 캡처 — 초등1 우선)
  try {
    const cards = page.locator('.dept-card-item');
    const n = await cards.count();
    let target = -1;
    for (let i = 0; i < n; i++) {
      const txt = await cards.nth(i).innerText();
      if (txt.includes('가입됨') || txt.includes('승인 대기')) continue;
      if (txt.includes('초등1')) { target = i; break; }
      if (target === -1) target = i;
    }
    if (target === -1) throw new Error('가입 신청 가능한 부서 카드가 없습니다 (모두 가입됨)');

    console.log('  [deptjoin-03] 역할 선택 모달');
    await cards.nth(target).click();
    await page.getByText('본인 역할을 선택해 주세요').waitFor({ timeout: 8000 });
    await page.waitForTimeout(800);
    await takeShot('deptjoin-03', '역할 선택',
      '부서 카드를 누르면 가입 신청 창이 열립니다(화면은 예시 부서입니다). 자녀를 보내는 분은 \'학부모\', 부서에서 섬기는 분은 \'교사\' 그림을 누릅니다.');

    console.log('  [deptjoin-04] 자녀 선택 화면 (학부모)');
    await page.locator('button:has(img[alt="학부모"])').click();
    await page.waitForTimeout(2000);
    await takeShot('deptjoin-04', '자녀 선택 (학부모로 신청할 때)',
      '학부모를 선택하면 자녀 선택 화면이 나옵니다. 교회에 등록된 정보로 자동으로 찾아진 자녀는 미리 체크되어 있고, 없으면 자녀 이름을 2자 이상 입력해 검색합니다. 자녀가 여러 명이면 모두 선택할 수 있습니다.');

    console.log('  [deptjoin-05] 최종 확인 화면');
    await page.getByText('이전').click();
    await page.waitForTimeout(600);
    await page.locator('button:has(img[alt="교사"])').click();
    await page.waitForTimeout(800);
    await takeShot('deptjoin-05', '가입 신청 — 최종 확인',
      '마지막 확인 화면입니다. \'가입 신청\' 버튼을 누르면 신청이 접수됩니다. 부서 임원진이 승인하면 가입이 완료되고, 홈 화면 \'내 사역·부서\'에 부서가 나타납니다. 학부모로 신청한 경우에는 선택한 자녀 목록이 함께 표시됩니다.');

    // 제출하지 않고 닫기
    await page.getByRole('button', { name: '취소' }).click();
    await page.waitForTimeout(400);
  } catch (err) {
    addError('deptjoin-03', '역할 선택', '부서 카드를 누르면 가입 신청 창이 열립니다.', err);
  }
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

    // 사역·부서 가입 챕터는 별도 처리 (로그인 후)
    if (chapter.type === 'deptjoin') {
      await captureDeptJoinChapter(page, chapter, manifest);
      continue;
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

  // manifest.json 저장 (챕터 소개 + 생성일 포함)
  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  const chaptersMeta = steps.chapters.map(c => ({ id: c.id, title: c.title, intro: c.intro || null }));
  fs.writeFileSync(manifestPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    chapters: chaptersMeta,
    items: manifest,
  }, null, 2));
  const ok = manifest.filter(m => m.shot).length;
  console.log(`\n✅ 완료! ${ok}/${manifest.length}개 스크린샷 생성`);

  // 자동 git commit + push → Vercel 자동 배포 (MANUAL_SKIP_GIT=1 이면 건너뜀)
  if (process.env.MANUAL_SKIP_GIT) {
    console.log('ℹ MANUAL_SKIP_GIT 설정됨 — git commit/push 건너뜀');
    return;
  }
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
