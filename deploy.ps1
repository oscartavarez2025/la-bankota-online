# deploy.ps1 — La Bankota: git add + commit + push automatico
# Atajo de teclado: Ctrl+Alt+K
$ErrorActionPreference = "Stop"
$dir = "A:\LA_BANKOTA\Bancas-test\8\bankota-v2\backend-postgres"
Set-Location $dir

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
$msg = "deploy: $timestamp"

try {
    git add .
    $status = git status --porcelain
    if ($status) {
        git commit -m $msg
        git push origin main
        $body = "✅ Subido a GitHub correctamente`n$timestamp"
    } else {
        $body = "ℹ️ Sin cambios que subir."
    }
} catch {
    $body = "❌ Error al subir: $_"
}

# Notificacion de escritorio
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show($body, "La Bankota Deploy", 0, 64)
