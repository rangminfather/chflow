# chflow 새 노트북 세팅 스크립트
# 사용법: PowerShell 열고 아래 한 줄 실행
#   irm https://raw.githubusercontent.com/rangminfather/chflow/main/setup.ps1 | iex

$ErrorActionPreference = "Stop"

Write-Host "`n=== chflow 개발환경 자동 세팅 ===" -ForegroundColor Cyan

# ── 1. Node.js ───────────────────────────────────────────────────────────────
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "`n[1/4] Node.js 설치 중..." -ForegroundColor Yellow
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
} else {
    Write-Host "`n[1/4] Node.js 이미 설치됨: $(node --version)" -ForegroundColor Green
}

# ── 2. Git ───────────────────────────────────────────────────────────────────
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "`n[2/4] Git 설치 중..." -ForegroundColor Yellow
    winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
} else {
    Write-Host "`n[2/4] Git 이미 설치됨: $(git --version)" -ForegroundColor Green
}

# ── 3. 저장소 clone ──────────────────────────────────────────────────────────
$targetDir = "$HOME\chflow"
Write-Host "`n[3/4] 저장소 clone → $targetDir" -ForegroundColor Yellow

if (Test-Path "$targetDir\.git") {
    Write-Host "  이미 clone됨, git pull 실행..." -ForegroundColor Gray
    git -C $targetDir pull origin main
} else {
    git clone https://github.com/rangminfather/chflow.git $targetDir
}

# ── 4. .env.local 생성 ───────────────────────────────────────────────────────
Write-Host "`n[4/4] .env.local 생성..." -ForegroundColor Yellow
$envPath = "$targetDir\chflow-app\.env.local"

if (Test-Path $envPath) {
    Write-Host "  .env.local 이미 존재 — 덮어쓰지 않음" -ForegroundColor Gray
} else {
@"
# 아래 값을 채워넣으세요 (기존 노트북의 chflow-app/.env.local 에서 복사)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
UMS_USER_ID=
UMS_PASSWORD=
"@ | Set-Content $envPath -Encoding utf8
    Write-Host "  .env.local 템플릿 생성됨 — 값은 기존 노트북에서 직접 복사하세요" -ForegroundColor Yellow
}

# ── 5. npm install ───────────────────────────────────────────────────────────
Write-Host "`n[5/5] npm install..." -ForegroundColor Yellow
Set-Location "$targetDir\chflow-app"
npm install

# ── 완료 ─────────────────────────────────────────────────────────────────────
Write-Host @"

========================================
  세팅 완료!

  개발 서버 실행:
    cd $targetDir\chflow-app
    npm run dev

  브라우저: http://localhost:3000
========================================
"@ -ForegroundColor Cyan
