# Registra una Tarea Programada de Windows que mantiene vivo el
# reminder-listener: el proceso que hace long-poll a wait_for_triggers de
# wacon y manda el WhatsApp cuando un recordatorio programado por
# SyncAcademicTasks llega a su hora. Sin esto, esos recordatorios de 24h
# antes NUNCA se disparan solos (wacon documenta que su daemon no envía
# nada por su cuenta).
#
# Uso (PowerShell, una vez):
#   .\scripts\register-reminder-listener-task.ps1

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$listenerScript = Join-Path $repoRoot "src\interfaces\daemon\reminder-listener.mjs"
$nodeExe = (Get-Command node).Source

if (-not (Test-Path $listenerScript)) {
    throw "No se encontró $listenerScript"
}

$taskName = "DuticWaconReminderListener"
$crashLog = Join-Path $env:USERPROFILE ".dutic-wacon-bridge\listener-crash.log"
# Se corre vía cmd.exe con la salida redirigida a un archivo aparte: si el
# proceso revienta ANTES de que exista nuestro propio logger (o el logger
# mismo falla), esta es la única forma de ver qué pasó — Task Scheduler no
# guarda stdout/stderr de un -Execute directo.
$cmdArgs = "/c `"`"$nodeExe`" `"$listenerScript`" >> `"$crashLog`" 2>&1`""
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $cmdArgs -WorkingDirectory $repoRoot
# Nota: en esta cuenta (no-admin) un trigger -AtLogOn devuelve "Acceso denegado" al
# registrar. -Once sí funciona y deja el proceso corriendo de una — el propio script
# hace su loop infinito, así que no hace falta repetición. Se agenda unos segundos en
# el futuro (no "ahora mismo") para no competir con un Start-ScheduledTask manual y
# terminar con dos procesos corriendo a la vez.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(15)
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "Long-poll a wait_for_triggers de wacon: manda el WhatsApp cuando un recordatorio de dutic-wacon-bridge llega a su hora." `
    -Force

Write-Host "Tarea '$taskName' registrada. Arranca sola en ~15s. Se reinicia sola si el proceso muere."
Write-Host "LIMITACION: no sobrevive un reinicio de Windows por si sola (AtLogOn requiere permisos que esta cuenta no tiene)."
Write-Host "Despues de reiniciar la PC, corre de nuevo este script o: Start-ScheduledTask -TaskName $taskName"
Write-Host "Log en vivo: Get-Content `"$env:USERPROFILE\.dutic-wacon-bridge\sync.log`" -Wait -Tail 20"
Write-Host "Log de caidas (stdout/stderr crudo): $crashLog"
