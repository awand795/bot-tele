# Push secret values from .env to Cloudflare Worker secrets.
# Usage:  .\scripts\set-secrets.ps1
#
# Worker secrets are write-only. This script reads .env and pipes each value
# to `wrangler secret put`, so the value is never printed to the terminal.

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "load-env.ps1")

$names = @(
  "BOT_TOKEN",
  "WEBHOOK_SECRET",
  "TERABOX_COOKIE",
  "INSTAGRAM_COOKIE",
  "TIKTOK_COOKIE",
  "YOUTUBE_COOKIE"
)

foreach ($name in $names) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    Write-Host "skip $name (kosong)"
    continue
  }

  Write-Host "set $name ..."
  $value | npx wrangler secret put $name
  if ($LASTEXITCODE -ne 0) {
    throw "Gagal set secret $name"
  }
}

Write-Host "Selesai. Cek daftar nama secret: npx wrangler secret list"
