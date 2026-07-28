# Alternativa a Task Scheduler para mantener vivo el reminder-listener:
# la carpeta de Inicio de Windows (shell:startup). No necesita permisos de
# administrador (a diferencia de un trigger -AtLogOn de Task Scheduler, que
# en esta cuenta da "Acceso denegado") y Windows la corre sola en cada login.
#
# listener-loop.cmd reinicia node solo si el proceso muere (sin depender de
# la política de Task Scheduler que lo mataba sin dejar rastro de error).
#
# Uso (PowerShell, una vez):
#   .\scripts\install-startup.ps1

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$loopScript = Join-Path $repoRoot "scripts\listener-loop.cmd"
$startupDir = [Environment]::GetFolderPath("Startup")
$vbsPath = Join-Path $startupDir "dutic-wacon-listener.vbs"

if (-not (Test-Path $loopScript)) {
    throw "No se encontró $loopScript"
}

# Ruta absoluta al .cmd baked-in — el .vbs vive en Startup, no junto al repo,
# así que no puede calcularla por relativa.
$vbsContent = @"
Set shell = CreateObject("WScript.Shell")
shell.Run "cmd /c ""$loopScript""", 0, False
"@
Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII

Write-Host "Instalado en Inicio de Windows: $vbsPath"
Write-Host "Se va a arrancar solo, sin ventana visible, en cada login."

# Arrancarlo ya mismo, sin esperar al próximo login.
$shell = New-Object -ComObject WScript.Shell
$shell.Run("wscript.exe `"$vbsPath`"", 0, $false)

Write-Host "Arrancado ahora mismo tambien."
Write-Host "Log: Get-Content `"$env:USERPROFILE\.dutic-wacon-bridge\sync.log`" -Wait -Tail 20"
Write-Host "Log de caidas/reinicios: $env:USERPROFILE\.dutic-wacon-bridge\listener-crash.log"
Write-Host ""
Write-Host "Para desinstalar: Remove-Item `"$vbsPath`""
