# dutic-wacon-bridge

Puente entre [`dutic-mcp`](../DUTIC-mcp) (aula virtual UNSA) y [`wacon-mcp`](../wacon-mcp)
(WhatsApp + agenda). No reemplaza a ninguno: **alimenta el motor de agenda y notificaciones
que wacon ya tiene** con las tareas académicas oficiales de DUTIC, y cruza esas fechas contra
lo que se dice en los grupos de WhatsApp de cada curso.

## Qué hace cada corrida (`npm run sync`)

1. Se asegura de que el daemon de wacon esté vivo (corre `wacon status`, que lo auto-levanta).
2. Corre `dutic tasks --all --json` (incluye las tareas ocultas).
3. Compara contra la corrida anterior (`~/.dutic-wacon-bridge/state.json`):
   - Tarea pendiente nueva → `addTask` + `scheduleEvent` (recordatorio 24h antes) en wacon.
   - Tarea que cambió de fecha → reprograma el recordatorio.
   - Tarea que pasó a entregada/calificada → cierra su tarea y cancela su recordatorio en wacon.
4. Cruza las tareas oficiales contra `listSuggestedEvents` (lo que wacon ya extrajo de los
   grupos de WhatsApp de curso vía `wacon init --courses`). Si hay más de ~20h de diferencia
   entre lo que dice Moodle y lo que dijo el grupo, crea una tarea `⚠️ Conflicto de fecha`.
5. Si hubo algo nuevo, manda un resumen por WhatsApp a tu propio número (`wacon send`).

Todo lo que entra queda visible con los comandos normales de wacon: `wacon tasks`,
`wacon agenda`, `wacon brief`.

## Requisitos

- `dutic` y `wacon` instalados globalmente y en el PATH (`npm ls -g` debe mostrarlos).
- `dutic login` ya hecho (sesión válida — verificar con `dutic status`).
- `wacon login` ya hecho (WhatsApp conectado — verificar con `wacon status`; sin esto, el
  paso 5 se salta solo y el resto sigue funcionando igual).
- Node.js ≥ 20.

## Uso manual

```bash
npm run sync
```

## Automatizar (cada 6h, sin depender de Claude Code)

```powershell
.\scripts\register-task.ps1
```

Registra una Tarea Programada de Windows (`DuticWaconBridge`) que corre `sync.mjs` cada 6
horas, incluso con la sesión cerrada. Log de cada corrida en
`~/.dutic-wacon-bridge/sync.log`.

Para quitarla: `Unregister-ScheduledTask -TaskName DuticWaconBridge -Confirm:$false`.

## Estado local

`~/.dutic-wacon-bridge/state.json` — mapea cada `cmid` de DUTIC a su reflejo en wacon
(`waconTaskId`, `waconEventId`) y a los conflictos ya avisados, para no duplicar ni repetir
notificaciones.

## Complemento: brief semanal con razonamiento (opcional)

Este puente resuelve la sincronización mecánica sin usar IA. Para un resumen más inteligente
(cruzar notas de SISACAD, prioridades, qué estudiar primero) conviene un agente de Claude Code
programado semanalmente (`/schedule`) con ambos MCP (`dutic` + `wacon`) registrados, que llame
`dutic_get_grades` + `dutic_list_tasks` + `wacon get_agenda`/`get_persona` y mande el resumen
por `send_message`. Ese agente no necesita este bridge — puede vivir aparte.
