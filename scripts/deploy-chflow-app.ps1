$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$vercelDir = Join-Path $root ".vercel"
$projectJson = Join-Path $root ".vercel\project.json"

if (!(Test-Path $projectJson)) {
  New-Item -ItemType Directory -Force -Path $vercelDir | Out-Null
  @{
    projectId = "prj_y26PnlBpVtwQLD3mV4WR4ycyuHXv"
    orgId = "team_3eCrL9o7VtbwBC6fpKFpwQlT"
    projectName = "chflow-app"
  } | ConvertTo-Json -Compress | Set-Content -Path $projectJson -Encoding UTF8
}

$project = Get-Content $projectJson -Raw | ConvertFrom-Json
if ($project.projectName -ne "chflow-app" -or $project.projectId -ne "prj_y26PnlBpVtwQLD3mV4WR4ycyuHXv") {
  throw "Refusing to deploy: root Vercel project must be chflow-app (prj_y26PnlBpVtwQLD3mV4WR4ycyuHXv), got $($project.projectName) / $($project.projectId)."
}

Push-Location $root
try {
  npx vercel --prod --yes
  $loginStatus = try {
    (Invoke-WebRequest -Uri "https://chflow-app.vercel.app/login" -UseBasicParsing -MaximumRedirection 0).StatusCode
  } catch {
    $_.Exception.Response.StatusCode.value__
  }

  if ($loginStatus -ne 200) {
    throw "Deployment completed, but https://chflow-app.vercel.app/login returned HTTP $loginStatus."
  }

  npx vercel inspect chflow-app.vercel.app
} finally {
  Pop-Location
}
