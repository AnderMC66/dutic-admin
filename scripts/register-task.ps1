# Registra una Tarea Programada de Windows que corre la sincronización
# DUTIC -> wacon cada 6 horas, aunque no haya sesión de usuario ni Claude
# Code abiertos.
#
# Uso (PowerShell, una vez):
#   .\scripts\register-task.ps1

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$syncScript = Join-Path $repoRoot "src\sync.mjs"
$nodeExe = (Get-Command node).Source

if (-not (Test-Path $syncScript)) {
    throw "No se encontró $syncScript"
}

$taskName = "DuticWaconBridge"
$action = New-ScheduledTaskAction -Execute $nodeExe -Argument "`"$syncScript`"" -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 6) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Sincroniza tareas de DUTIC hacia la agenda de wacon cada 6h" -Force

Write-Host "Tarea '$taskName' registrada. Corre cada 6h. Revisa con: Get-ScheduledTask -TaskName $taskName"
Write-Host "Log de cada corrida: $env:USERPROFILE\.dutic-wacon-bridge\sync.log"
