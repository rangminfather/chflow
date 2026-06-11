# chflow 구글드라이브 동기화 스크립트
# 새 노트북 최초 1회: rclone 설치 + 구글 로그인 필요 (아래 SETUP 참고)
#
# ── 사용법 ──────────────────────────────────────────────────────────────────
#   다운로드 (구글드라이브 → 로컬):  .\sync.ps1 down
#   업로드   (로컬 → 구글드라이브):  .\sync.ps1 up
#   양방향   (최신 기준 자동):        .\sync.ps1 bi
#
# ── 새 노트북 최초 세팅 (SETUP) ─────────────────────────────────────────────
#   1. winget install Rclone.Rclone
#   2. PowerShell 에서:
#      rclone config create gdrive drive scope drive
#      → 브라우저 구글 로그인
#   3. 이 스크립트 실행: .\sync.ps1 down

param([string]$mode = "bi")

$local  = "C:\csh\project\chflow\자료"
$remote = "gdrive:chflow/자료"

if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
    Write-Host "rclone 없음. 설치 중..." -ForegroundColor Yellow
    winget install Rclone.Rclone --accept-source-agreements --accept-package-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
}

switch ($mode) {
    "down" {
        Write-Host "구글드라이브 → 로컬 다운로드..." -ForegroundColor Cyan
        rclone copy $remote $local --progress --transfers 4
    }
    "up" {
        Write-Host "로컬 → 구글드라이브 업로드..." -ForegroundColor Cyan
        rclone copy $local $remote --progress --transfers 4
    }
    "bi" {
        Write-Host "양방향 동기화..." -ForegroundColor Cyan
        rclone bisync $local $remote --progress --transfers 4 --resilient
    }
    default {
        Write-Host "사용법: .\sync.ps1 [down|up|bi]" -ForegroundColor Yellow
    }
}

Write-Host "`n동기화 완료" -ForegroundColor Green
