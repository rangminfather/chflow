param(
  [string]$RoleDir = "C:\csh\project\chflow\chflow-app\public\roles",
  [string]$BackupDir = "C:\csh\project\chflow\MS_AX\archive\2026-05-19_role_images_original",
  [int]$TargetWidth = 360,
  [int]$TargetHeight = 580
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $RoleDir)) {
  throw "Role image directory not found: $RoleDir"
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$files = Get-ChildItem -LiteralPath $RoleDir -Filter "*.png" -File | Sort-Object Name

foreach ($file in $files) {
  $backupPath = Join-Path $BackupDir $file.Name
  if (-not (Test-Path -LiteralPath $backupPath)) {
    Copy-Item -LiteralPath $file.FullName -Destination $backupPath
  }

  $source = [System.Drawing.Image]::FromFile($file.FullName)
  try {
    $canvas = New-Object System.Drawing.Bitmap $TargetWidth, $TargetHeight
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    try {
      $graphics.Clear([System.Drawing.Color]::White)
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

      $scale = [Math]::Min($TargetWidth / $source.Width, $TargetHeight / $source.Height)
      $drawWidth = [int][Math]::Round($source.Width * $scale)
      $drawHeight = [int][Math]::Round($source.Height * $scale)
      $left = [int][Math]::Round(($TargetWidth - $drawWidth) / 2)
      $top = [int][Math]::Round(($TargetHeight - $drawHeight) / 2)

      $graphics.DrawImage($source, $left, $top, $drawWidth, $drawHeight)
    }
    finally {
      $graphics.Dispose()
    }

    $tmp = "$($file.FullName).tmp.png"
    $canvas.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()
    $source.Dispose()
    $source = $null
    [System.IO.File]::Copy($tmp, $file.FullName, $true)
    Remove-Item -LiteralPath $tmp -Force
  }
  finally {
    if ($null -ne $source) {
      $source.Dispose()
    }
  }
}

[pscustomobject]@{
  Normalized = $files.Count
  RoleDir = $RoleDir
  BackupDir = $BackupDir
  TargetWidth = $TargetWidth
  TargetHeight = $TargetHeight
}
