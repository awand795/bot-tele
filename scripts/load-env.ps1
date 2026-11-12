# Load .env ke sesi PowerShell saat ini.
# Usage:  . .\scripts\load-env.ps1

$envFile = Join-Path (Split-Path -Parent $PSScriptRoot) ".env"

if (-not (Test-Path $envFile)) {
  throw "File .env tidak ditemukan. Salin .env.example menjadi .env lalu isi nilainya."
}

Get-Content $envFile -Encoding UTF8 | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }

  $eq = $line.IndexOf("=")
  if ($eq -lt 1) { return }

  $name = $line.Substring(0, $eq).Trim()
  $value = $line.Substring($eq + 1).Trim()

  if ($value.Length -ge 2) {
    $first = $value.Substring(0, 1)
    $last = $value.Substring($value.Length - 1, 1)
    if (($first -eq "'" -and $last -eq "'") -or ($first -eq '"' -and $last -eq '"')) {
      $value = $value.Substring(1, $value.Length - 2)
    }
  }

  Set-Item -Path "Env:$name" -Value $value
}

Write-Host "Loaded environment from $envFile"
