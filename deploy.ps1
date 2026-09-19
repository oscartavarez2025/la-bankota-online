# deploy.ps1 — La Bankota: git add + commit + push automatico
$ErrorActionPreference = "Stop"
$dir = $PSScriptRoot
Set-Location $dir

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
$msg = "deploy: $timestamp"

try {
    Write-Host "1. Agregando archivos modificados (git add .)..." -ForegroundColor Cyan
    git add .
    $status = git status --porcelain
    if ($status) {
        Write-Host "2. Creando commit: $msg..." -ForegroundColor Cyan
        git commit -m "$msg"
        Write-Host "3. Subiendo a GitHub (git push origin main)..." -ForegroundColor Cyan
        git push origin main
        $body = "[OK] Subido a GitHub correctamente`n$timestamp"
        Write-Host "`n$body" -ForegroundColor Green
    } else {
        $body = "[INFO] Sin cambios pendientes que subir."
        Write-Host "`n$body" -ForegroundColor Yellow
    }
} catch {
    $body = "[ERROR] Error al subir: $_"
    Write-Host "`n$body" -ForegroundColor Red
}

try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($body, "La Bankota Deploy", 0, 64)
} catch {
    # Si falla UI, no bloquear
}
