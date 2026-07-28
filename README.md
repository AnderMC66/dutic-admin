# dutic-wacon-bridge

Puente entre [`dutic-mcp`](../DUTIC-mcp) (aula virtual UNSA) y [`wacon-mcp`](../wacon-mcp)
(WhatsApp + agenda). No reemplaza a ninguno: **alimenta el motor de agenda y notificaciones
que wacon ya tiene** con las tareas académicas oficiales de DUTIC, cruza esas fechas contra
lo que se dice en los grupos de WhatsApp de cada curso, y expone todo también como su propio
servidor MCP para consultarlo a pedido.

## Cuatro formas de usarlo

1. **Cron (`npm run sync`)** — corre solo cada 6h vía Tarea Programada de Windows, sin
   depender de que Claude Code esté abierto. Sincroniza mecánicamente y avisa por WhatsApp.
2. **Reminder listener** (`npm run listen`, o instalado en Inicio de Windows — ver
   [Automatizar](#automatizar)) — proceso siempre-vivo con tres trabajos:
   - Manda el WhatsApp cuando un recordatorio programado por el cron llega a su hora
     (long-poll a `wait_for_triggers`). **Imprescindible**: wacon documenta que su motor
     proactivo nunca manda nada por su cuenta — sin este proceso, los recordatorios de
     "24h antes" quedan disparados en el vacío, sin nadie escuchando.
   - **Responde comandos que escribís** en el chat configurado (ver
     [Comandos por WhatsApp](#comandos-por-whatsapp)): `!brief`, `!sync`, `!riesgo`,
     `!docentes 2279`, etc. Así consultás al bridge desde el celular, sin abrir Claude Code.
   - **Manda el brief solo, una vez al día** (7am hora de Lima), sin que lo pidas — ver
     [Brief diario automático](#brief-diario-automático).
3. **Servidor MCP (`npm run mcp`)** — registrado en Claude Code como `dutic-wacon-bridge`;
   le preguntas directamente ("¿qué tengo pendiente?", "fuerza un sync", "¿algún curso en
   riesgo?", "dame consejo de estudio para X") sin esperar el cron. Pensado para que lo
   invoque un **agente de IA**, no un humano tipeando en una terminal.
4. **CLI nativa, `duticbat`** (`npm run cli -- <comando>`, o `duticbat <comando>` si instalaste
   el paquete globalmente) — los mismos comandos que por WhatsApp (`brief`, `sync`, `riesgo`,
   `docentes 2279`, ...) pero tipeados directo en tu terminal, sin "!" y con la respuesta
   impresa ahí mismo. Corrida sin argumentos abre un **panel interactivo** a pantalla completa.
   Ver [CLI nativa](#cli-nativa).

Las cuatro usan exactamente los mismos casos de uso — ver [Arquitectura](#arquitectura). MCP
y CLI nativa son deliberadamente dos puertas de entrada distintas al mismo código: MCP es
para que un agente de IA llame funciones de forma estructurada (JSON-RPC sobre stdio); la CLI
es para que **vos** tipees comandos y leas texto — la misma separación que ya tienen `dutic`
y `wacon` (CLI humana + servidor MCP, mismo código).

## Qué hace cada corrida del cron (`SyncAcademicTasks`)

1. Se asegura de que el daemon de wacon esté vivo (corre `wacon status`, que lo auto-levanta).
2. Corre `dutic tasks --all --json` (incluye las tareas ocultas).
3. Compara contra la corrida anterior (`~/.dutic-wacon-bridge/state.json`):
   - Tarea pendiente nueva → `addTask` + `scheduleEvent` (recordatorio 24h antes) en wacon, **y
     un WhatsApp individual para esa tarea** con las indicaciones completas (la consigna que
     puso el profesor) y, si tiene adjuntos (guía, rúbrica, enunciado), los descarga
     (`dutic download`) y los manda como archivo (`sendFile`) junto al mensaje.
   - Tarea que cambió de fecha → reprograma el recordatorio.
   - Tarea que pasó a entregada/calificada → cierra su tarea y cancela su recordatorio en wacon.
4. Cruza las tareas oficiales contra `listSuggestedEvents` (lo que wacon ya extrajo de los
   grupos de WhatsApp de curso vía `wacon init --courses`). Si hay más de ~20h de diferencia
   entre lo que dice Moodle y lo que dijo el grupo, crea una tarea `⚠️ Conflicto de fecha`.
5. De las tareas ya vencidas y sin entregar, separa las que el grupo ya explicó (alguien
   mencionó una prórroga) de las que están vencidas **en silencio** — la señal más urgente.
6. Si hubo algo nuevo, manda un resumen por WhatsApp a tu propio número (`wacon send`).

Todo lo que entra queda visible con los comandos normales de wacon: `wacon tasks`,
`wacon agenda`, `wacon brief`.

## Herramientas MCP (`dutic-wacon-bridge`)

| Tool | Qué hace |
|---|---|
| `bridge_get_unified_brief` | Foto en vivo: pendientes, riesgo de notas, conflictos de fecha, vencidas sin aviso, **+ brief social de wacon** (mensajes sin responder, compromisos). Solo lectura. |
| `bridge_force_sync` | Corre `SyncAcademicTasks` ya mismo, sin esperar el cron. |
| `bridge_assess_grade_risk` | Riesgo de reprobar por curso (Moodle % + SISACAD si ya está capturado). |
| `bridge_prefetch_exam_materials` | Descarga y convierte a Markdown el material de cursos con examen próximo. |
| `bridge_cross_reference_classmates` | Roster oficial de un curso vs. miembros del grupo de WhatsApp — requiere mapeo previo. |
| `bridge_get_study_advice` | Consejo de estudio citando material real vía el NotebookLM vinculado al grupo del curso (`wacon consultPlaybook`). |
| `bridge_get_course_digest` | Resumen comprimido de lo último que se habló en el grupo del curso, sin leer el chat entero. |
| `bridge_get_course_teachers` | Docentes de un curso. |
| `bridge_list_courses` | Tus cursos con su courseId — llamalo antes de cualquier tool que pida uno. |
| `bridge_pull_all_materials` | Descarga TODO el material de un curso (más amplio que `bridge_prefetch_exam_materials`). |
| `bridge_export_calendar` | Genera un `.ics` con tus entregas y lo manda por WhatsApp — importalo al calendario del teléfono. |

`bridge_get_unified_brief.pendingTasks` viene ordenado por **prioridad de estudio**, no por
fecha: combina el peso real de la evaluación en la libreta de notas (cuando se puede
identificar el ítem correspondiente) con la urgencia — algo con 40% de la nota y 3 días
encima pesa más que algo con 5% y esa misma fecha.

Registrado con `claude mcp add dutic-wacon-bridge -- node <ruta>/src/interfaces/mcp/server.mjs`.

## Comandos por WhatsApp

Con el `reminder-listener` corriendo, escribís estos comandos y te responde ahí mismo — los
mismos casos de uso que el servidor MCP, en texto corto en vez de JSON:

| Comando | Qué hace |
|---|---|
| `!brief` | Qué tengo pendiente (académico + WhatsApp). |
| `!sync` | Forzar sincronización DUTIC → wacon ahora. |
| `!riesgo` | Riesgo de reprobar por curso. |
| `!docentes <courseId>` | Docentes de un curso. |
| `!digest <courseId>` | Resumen del grupo de WhatsApp del curso. |
| `!companeros <courseId>` | Roster oficial vs. grupo de WhatsApp. |
| `!estudio <courseId> <tema...>` | Consejo de estudio (NotebookLM). |
| `!material <courseId>` | Descargar todo el material del curso. |
| `!examen [dias]` | Preparar material de exámenes próximos (default 3 días). |
| `!calendario` | `.ics` con tus entregas, para el calendario del teléfono. |
| `!cursos` | Tus cursos con su courseId — para no tener que memorizarlos. |
| `!ayuda` | Esta lista. |

### ⚠️ IMPORTANTE: no funciona en "Mensajes para mí" — usá un grupo

Probado en vivo (dos veces, incluso con reconexión completa de WhatsApp): los mensajes que te
escribís en el chat especial "Mensajes para mí" **nunca llegan** a la sesión vinculada de
Baileys — es una limitación de cómo WhatsApp maneja ese chat especial (no sincroniza en
tiempo real hacia dispositivos vinculados, a diferencia de chats y grupos normales, que sí
sincronizan bien).

**La solución**: crear un grupo de WhatsApp con vos como único miembro (agregás a cualquier
contacto para poder crear el grupo, y después lo sacás), y configurar su JID en
`~/.dutic-wacon-bridge/config.json`:

```json
{ "commandChatJid": "120363xxxxxxxxxxxx@g.us" }
```

Sin este valor configurado, cae por defecto a tu propio chat (que no funciona para comandos
desde el celular, aunque los avisos salientes del bridge sí se ven bien ahí). Para encontrar
el JID de tu grupo: `wacon chats --json` y buscá el `jid` que termina en `@g.us` con el
nombre de tu grupo.

**Por qué wacon no reacciona directo a `wait_for_triggers`**: descarta a propósito tus propios
envíos de su sistema de "atención" (`if (msg.from_me) return`, con el comentario "our own
sends never wake an agent"). El listener sondea el chat configurado por separado con
`readMessages` (que sí guarda tus mensajes, en cualquier chat/grupo) cada ~20s, filtrando solo
lo nuevo desde la última vez. El prefijo `!` evita que el bot reaccione a sus propios avisos
(que usan emojis, nunca `!`).

## CLI nativa (`duticbat`)

Los mismos comandos de la tabla de arriba, sin "!" y tipeados directo en tu terminal — no
necesita el `reminder-listener` corriendo, arma su propia conexión y termina sola.

**Instalar una vez** (queda disponible como `duticbat` desde cualquier terminal, igual que
`dutic` y `wacon`):

```bash
cd dutic-wacon-bridge
npm link
```

**Uso directo** (para scripts o cuando ya sabés el comando):

```bash
duticbat brief
duticbat docentes 2279
duticbat estudio 2279 "cómo estructurar el TIF"
```

**Panel interactivo** (para cuando no te acordás el nombre exacto o los argumentos): corré
`duticbat` sin nada más, en una terminal real — usa todo el ancho de la terminal, agrupa los
comandos por categoría, y se limpia/redibuja en cada vuelta:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ 📚  DUTIC ⇄ WACON — panel de comandos                 28/07/26, 8:27 a. m. │
└────────────────────────────────────────────────────────────────────────────┘

  ACADÉMICO
    1  brief        Qué tengo pendiente (académico + WhatsApp)
    2  sync         Forzar sincronización DUTIC → wacon
    3  riesgo       Riesgo de reprobar por curso
    4  calendario   Exportar calendario .ics (te lo manda por WhatsApp)
    5  cursos       Tus cursos con su courseId

  POR CURSO
    6  docentes     Docentes de un curso
    7  digest       Resumen del grupo de WhatsApp del curso
    8  companeros   Roster oficial vs. grupo de WhatsApp
    9  estudio      Consejo de estudio (NotebookLM)
   10  material     Descargar todo el material de un curso
   11  examen       Preparar material de exámenes próximos

    0  salir        Cerrar el panel

──────────────────────────────────────────────────────────────────────────────
› Elegí un comando (número o nombre, 0 para salir): docentes

Tus cursos:
   2287  DERECHO EMPRESARIAL (E) GA
   2247  DESARROLLO EMOCIONAL, GESTIÓN DE CONFLICTOS Y LIDERAZGO GA
   2245  ECOLOGÍA Y CONSERVACIÓN AMBIENTAL GE
   2279  ECONOMÍA POLÍTICA (E) GA
   ...

courseId: 2279

⏳ Corriendo docentes...
👨‍🏫 Docentes del curso 2279:
• JOSE DOMINGO ZUZUNAGA MELGAR

(Enter para volver al menú)
```

**Antes de pedirte un `courseId`, el panel te muestra tu lista de cursos** (courseId + nombre,
sin el prefijo de semestre/carrera que se repite en todos) — la trae una sola vez por sesión
del panel y la reusa en las siguientes preguntas, para no repetir la consulta a DUTIC en cada
comando. `!cursos` / `duticbat cursos` / `bridge_list_courses` dan lo mismo por WhatsApp, CLI
directa y MCP.

Te pregunta los datos que le falten (courseId, tema...) uno por uno y vuelve al panel después
de cada comando — `0` para salir. Con color si la terminal lo soporta (respeta `NO_COLOR`);
sin color y sin panel si corrés `duticbat` desde un script o con la salida redirigida (no una
terminal real) — ahí imprime la ayuda en su lugar.

- `interfaces/cli/ui.mjs` — helpers de color/layout (caja de ancho completo, regla, sin deps).
- `interfaces/cli/menu.mjs` — metadata de cada comando (categoría, qué preguntar) + el loop.
- `interfaces/cli/duticbat.mjs` — decide entre modo directo, panel y ayuda.

Sin instalar global, también funciona con `node src/interfaces/cli/duticbat.mjs <comando>`
o `npm run cli -- <comando>`.

Mismo código que WhatsApp (`interfaces/commands/commandHandlers.mjs`, compartido) — por eso
`sync`, `material`, `examen` y `calendario` **también** mandan su aviso normal por WhatsApp
además de imprimir en la terminal: no son atajos silenciosos, son la misma acción real,
disparada desde otra puerta.

## Brief diario automático

Cada ciclo del `reminder-listener` (~20s) chequea si ya pasaron las **7am hora de Lima** y
todavía no se mandó el brief de hoy (`state.lastDailyBriefDate`, comparado con fecha/hora
Lima calculadas en `domain/services/DailyScheduleClock.mjs` — UTC-5 fijo, sin horario de
verano). Si toca, manda el mismo contenido de `!brief` sin que lo pidas — "☀️ Brief del día".
Si el listener no estuvo corriendo a las 7am (PC apagada, etc.), lo manda apenas vuelve a
arrancar, no lo salta.

## Arquitectura

Clean Architecture / puertos y adaptadores. La regla es de una sola vía: `domain` no depende
de nada, `application` solo depende de `domain` y de sus propios puertos (interfaces),
`infrastructure` implementa esos puertos, e `interfaces` (composition root) es el único punto
que conecta implementaciones concretas a los casos de uso.

```
src/
├── domain/                          # reglas puras, sin I/O — testeables sin mocks
│   ├── entities/
│   │   ├── AcademicTask.mjs               (isPending, isExamTask, isDueWithin, taskTitle...)
│   │   ├── Reminder.mjs                   (isBridgeReminder, buildReminderText)
│   │   └── Command.mjs                    (parseCommand: "!nombre args" → {name, args})
│   └── services/
│       ├── CourseMatcher.mjs              (heurística de nombre de curso, compartida)
│       ├── ConflictDetector.mjs           (Moodle vs. grupo de WhatsApp)
│       ├── OverdueAnalyzer.mjs            (vencida en silencio vs. con aviso)
│       ├── GradeRisk.mjs                  (% Moodle + % SISACAD → riesgo por curso)
│       ├── NameMatcher.mjs                (roster oficial vs. nombre de WhatsApp)
│       ├── StudyPriority.mjs              (peso de la evaluación + urgencia → orden de !brief)
│       ├── DailyScheduleClock.mjs         (hora Lima, si ya toca mandar el brief diario)
│       └── IcsBuilder.mjs                 (arma el .ics de !calendario)
│
├── application/                     # orquestación — no sabe que existen dutic ni wacon
│   ├── ports/                             (AgendaPort, NotifierPort, TriggerSourcePort,
│   │                                        TargetChatPort, FileWriterPort, ...)
│   └── use-cases/
│       ├── SyncAcademicTasks.mjs          (el cron)
│       ├── RunListenerCycle.mjs           (el reminder-listener, 1 iteración: recordatorios +
│       │                                    comandos + brief diario)
│       ├── GetUnifiedBrief.mjs            (foto de solo lectura, académico + social)
│       ├── AssessGradeRisk.mjs
│       ├── PrefetchExamMaterials.mjs
│       ├── PullAllCourseMaterials.mjs
│       ├── CrossReferenceClassmates.mjs
│       ├── GetStudyAdvice.mjs             (NotebookLM vía consultPlaybook)
│       ├── GetCourseDigest.mjs
│       ├── GetCourseTeachers.mjs
│       ├── ExportCalendar.mjs             (.ics de tareas pendientes)
│       └── ListCourses.mjs                (courseId + nombre — usado antes de pedir un courseId)
│
├── infrastructure/                   # adaptadores concretos — implementan los puertos
│   ├── dutic/      (DuticCliTaskSource, DuticCliGradesSource, DuticCliSisacadSource,
│   │                 DuticCliMaterialsAdapter, DuticCliPeopleSource, DuticCliTeachersAdapter,
│   │                 DuticCliCoursesAdapter, DuticCliAttachmentsAdapter, execDutic.mjs)
│   ├── wacon/      (WaconDaemonClient, WaconAgendaAdapter, WaconNotifier, WaconTriggerAdapter,
│   │                 WaconGroupMembersAdapter, WaconBriefingAdapter, WaconPlaybookAdapter,
│   │                 WaconDigestAdapter, WaconIdentityAdapter, WaconMessageHistoryAdapter)
│   ├── persistence/(FileStateRepository, FileCourseGroupMap, FileTargetChatConfig,
│   │                 NodeFileWriterAdapter)
│   ├── logging/    (ConsoleFileLogger)
│   └── compositionRoot.mjs                (arma todos los adaptadores una vez, para los 3 entrypoints)
│
└── interfaces/
    ├── commands/commandHandlers.mjs        (comando "nombre" → caso de uso → texto; compartido
    │                                         por WhatsApp y la CLI — buildBriefText() la reusa
    │                                         también el brief diario)
    ├── cli/
    │   ├── sync-cli.mjs                       (entrypoint del cron)
    │   ├── duticbat.mjs                       (CLI nativa: comando directo, panel o ayuda)
    │   ├── menu.mjs                           (panel interactivo: pregunta comando + args)
    │   └── ui.mjs                             (color/layout sin deps: caja, regla, ancho de terminal)
    ├── daemon/reminder-listener.mjs        (entrypoint siempre-vivo: WhatsApp + brief diario)
    └── mcp/server.mjs                     (entrypoint del servidor MCP)
```

**Por qué así:** ningún caso de uso importa nada de `dutic` ni de `wacon` — solo reciben
objetos que cumplen sus puertos, por constructor. Por eso agregar una fuente académica
distinta, otro canal de aviso, o un tool MCP nuevo es escribir un adaptador en
`infrastructure/` y cablearlo en un `interfaces/`, sin tocar el dominio ya probado. También
hace que sea trivial de testear: un test de caso de uso usa dobles de prueba en memoria para
los puertos, sin tocar red ni el daemon de wacon.

## Requisitos

- `dutic` y `wacon` instalados globalmente y en el PATH (`npm ls -g` debe mostrarlos).
- `dutic login` ya hecho (sesión válida — verificar con `dutic status`).
- `wacon login` ya hecho (WhatsApp conectado — verificar con `wacon status`; sin esto, los
  avisos por WhatsApp se saltan solos y el resto sigue funcionando igual).
- Node.js ≥ 20.
- `npm install` (trae `@modelcontextprotocol/sdk` + `zod`, solo para el servidor MCP).

## Uso manual

```bash
npm run sync            # sincronización única (lo que hace el cron)
npm run listen          # reminder-listener en primer plano (Ctrl+C para parar)
npm run mcp             # servidor MCP por stdio (normalmente lo arranca Claude Code, no a mano)
npm run cli -- brief    # CLI nativa — ver "CLI nativa" más arriba para la lista de comandos
```

## Automatizar

```powershell
.\scripts\register-task.ps1   # cron: sync cada 6h, vía Tarea Programada de Windows
```

`DuticWaconBridge` corre `sync-cli.mjs` cada 6 horas, incluso con la sesión cerrada. Log en
`~/.dutic-wacon-bridge/sync.log`. Para quitarla: `Unregister-ScheduledTask -TaskName
DuticWaconBridge -Confirm:$false`.

### El reminder-listener: carpeta de Inicio, no Task Scheduler

```powershell
.\scripts\install-startup.ps1
```

Probamos registrar el reminder-listener como Tarea Programada
(`scripts\register-reminder-listener-task.ps1`, sigue en el repo por si sirve más adelante) y
moría solo cada pocos minutos, sin dejar ningún error — en esta cuenta (sin permisos de
administrador) algo del lado de Windows lo termina, y no se pudo diagnosticar del todo sin
acceso al registro de eventos (`Acceso denegado` al intentar habilitarlo). El cron de 6h nunca
tuvo este problema — es específico de un proceso pensado para correr indefinidamente.

La alternativa que sí funciona: la carpeta de **Inicio de Windows** (`shell:startup`), que
no necesita permisos de administrador. `install-startup.ps1`:
1. Escribe `dutic-wacon-listener.vbs` ahí — Windows lo corre solo, sin ventana visible, en
   cada inicio de sesión.
2. Ese `.vbs` arranca `scripts\listener-loop.cmd`, que reinicia `node` solo si el proceso
   muere (nuestro propio mecanismo de reinicio, sin depender de Task Scheduler para eso).
3. Lo arranca también de inmediato, sin esperar al próximo login.

Log normal en `~/.dutic-wacon-bridge/sync.log`; reinicios/caídas del loop en
`~/.dutic-wacon-bridge/listener-crash.log`. Para desinstalar: borrar
`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\dutic-wacon-listener.vbs`.

Si más adelante conseguís correr PowerShell "como administrador" una vez, avisá — con eso se
puede diagnosticar la causa real de por qué Task Scheduler lo mataba, o registrar con
`-AtLogOn` (que hoy da "Acceso denegado" sin privilegios elevados).

## Estado y configuración local (`~/.dutic-wacon-bridge/`)

- `state.json` — qué tareas ya se reflejaron en wacon, qué conflictos/vencidas-sin-aviso ya
  se avisaron, el último estado de riesgo por curso, y los cursores (`triggerListener`,
  `lastCommandTs`) del reminder-listener para no repetir ni perder nada entre reinicios.
- `config.json` — `commandChatJid`: a qué chat van los avisos y de dónde se leen los
  comandos. Vacío = tu propio chat (no sirve para comandos desde el celular, ver la sección de
  comandos más arriba). Se autogenera vacío en el primer uso.
- `course-groups.json` — mapeo manual `courseId` (dutic) → JID de grupo (wacon), necesario
  para `bridge_cross_reference_classmates`, `bridge_get_study_advice` y
  `bridge_get_course_digest`. Se autogenera vacío (con instrucciones) en el primer uso; lo
  llenas a mano con `dutic courses --json` + `wacon chats --json`. **No se auto-detecta a
  propósito**: el nombre de un grupo de WhatsApp casi nunca calza con el nombre oficial del
  curso, y adivinar mal generaría cruces falsos.
- `adjuntos/<cmid>/` — archivos descargados de las consignas (guías, rúbricas) de cada tarea
  nueva, los mismos que se mandan por WhatsApp.
- `materiales-completos/<courseId>/` — descargas de `bridge_pull_all_materials`.
- `sync.log` — log compartido de las tres corridas (cron, listener, MCP).

## Limitaciones conocidas

- **El motor proactivo de wacon nunca envía solo**: `scheduleEvent` con `notifyBeforeMinutes`
  solo crea una fila en la base de datos de wacon; cuando llega la hora, el daemon la marca
  "fired" y la mete en un buffer interno — nadie recibe nada a menos que un proceso esté
  haciendo long-poll a `wait_for_triggers` en ese momento (o poco después, gracias al cursor).
  Por eso existe el `reminder-listener`: sin él, los recordatorios de 24h-antes no llegan.
- **`bridge_get_course_digest` filtra del lado del cliente**: `wacon.digest()` es global (no
  toma un chat específico); el bridge pide un límite alto y filtra por el JID del curso, así
  que si el grupo del curso tuvo cero actividad en la ventana pedida, no aparece en absoluto —
  se trata como "sin actividad", no como error.
- **`bridge_get_study_advice` depende de configuración de wacon que este bridge no controla**:
  el chat del curso tiene que estar etiquetado (`wacon tag <chat> <tag>`) y el tag mapeado a
  un notebook en `~/.wacon/notebooks.json`. Si falta algo, la herramienta responde con
  `consulted: false` y una nota explicando qué falta, en vez de fallar.
- **Prioridad de estudio es heurística**: para saber el peso real de una tarea en la nota,
  cruza su nombre contra los ítems de la libreta por superposición de palabras
  (`NameMatcher.namesMatch`) — si no encuentra un ítem que calce, usa un peso por defecto (10%)
  en vez de tratarla como 0%, para no hacerla desaparecer del orden de prioridad.
- **Adjuntos con caracteres raros en el nombre**: la descarga pasa por el shim `dutic.cmd` de
  Windows (`shell:true`), que no escapa solo — el bridge cita cada argumento a mano
  (`execDutic.mjs`) para que nombres con espacios/tildes no se corten.
- **Riesgo de notas sin SISACAD**: sin `dutic sisacad` corrido al menos una vez (login +
  CAPTCHA manual, no automatizable), el riesgo se calcula solo con el % que expone Moodle,
  que puede no reflejar el peso real de cada evaluación todavía.
- **Escala de notas de Moodle**: el `total` crudo que da Moodle NO está en una escala fija
  por curso (un curso puede estar sobre 15 puntos, otro sobre 140) — por eso todo el cálculo
  de riesgo usa `totalPercentage`, la única magnitud comparable entre cursos.
- **Cruce de compañeros**: solo funciona para cursos ya mapeados a mano en
  `course-groups.json`, y el emparejamiento de nombres es heurístico (funciona bien con
  nombres/apodos parciales, pero puede fallar con homónimos).
