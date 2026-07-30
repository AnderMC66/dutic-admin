/**
 * Cubre los arreglos 5-9: reprogramación que también corrige la tarea, brief
 * diario que no se pierde por un fallo transitorio, cierre que no deja eventos
 * huérfanos, saneado de nombres de adjunto y match de cursos por puntaje.
 *
 * Todo con dobles de prueba: ni disco, ni red, ni procesos.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = pathToFileURL(join(import.meta.dirname, "..", "src")).href;
const { WaconAgendaAdapter } = await import(`${SRC}/infrastructure/wacon/WaconAgendaAdapter.mjs`);
const { RunListenerCycle } = await import(`${SRC}/application/use-cases/RunListenerCycle.mjs`);
const { safeFileName } = await import(`${SRC}/domain/services/SafeFileName.mjs`);
const { courseSimilarity, sameCourse, findBestCourseMatch } = await import(`${SRC}/domain/services/CourseMatcher.mjs`);

/** Cliente RPC falso: registra las llamadas y deja fallar las que se le pidan. */
function fakeClient({ fail = [], results = {} } = {}) {
  const calls = [];
  return {
    calls,
    methods: () => calls.map((c) => c.method),
    rpc: async (method, args) => {
      calls.push({ method, args });
      if (fail.includes(method)) throw new Error(`${method} explotó`);
      return results[method] ?? { id: `${method}-id` };
    },
  };
}

// ------------------------------------------------------- #5 reschedule

test("reschedule reemplaza la tarea, no solo el evento (wacon no tiene updateTask)", async () => {
  const client = fakeClient({ results: { addTask: { id: 99 }, scheduleEvent: { id: 500 } } });
  const agenda = new WaconAgendaAdapter(client);

  const r = await agenda.reschedule({
    taskId: 7,
    eventId: 42,
    title: "[DUTIC] CURSO A: Tarea",
    dueDateIso: "2026-08-01T05:00:00.000Z",
    notifyBeforeMinutes: 1440,
  });

  assert.deepEqual(client.methods(), ["cancelEvent", "addTask", "completeTask", "scheduleEvent"]);
  assert.equal(r.taskId, 99, "devuelve el id de la tarea nueva, para que el estado lo persista");
  assert.equal(r.eventId, 500);

  // La nueva se crea ANTES de cerrar la vieja: nunca te quedás sin tarea.
  const orden = client.methods();
  assert.ok(orden.indexOf("addTask") < orden.indexOf("completeTask"));
  assert.equal(client.calls.find((c) => c.method === "addTask").args[0].due, "2026-08-01T05:00:00.000Z");
});

test("si addTask falla al reprogramar, se conserva la tarea vieja en vez de perderla", async () => {
  const client = fakeClient({ fail: ["addTask"], results: { scheduleEvent: { id: 500 } } });
  const r = await new WaconAgendaAdapter(client).reschedule({ taskId: 7, eventId: 42, title: "T", dueDateIso: "2026-08-01T05:00:00.000Z" });

  assert.equal(r.taskId, 7, "sigue siendo la vieja");
  assert.ok(!client.methods().includes("completeTask"), "no se cerró la vieja si no hubo reemplazo");
});

test("reschedule sin fecha no agenda evento pero igual corrige la tarea", async () => {
  const client = fakeClient({ results: { addTask: { id: 99 } } });
  const r = await new WaconAgendaAdapter(client).reschedule({ taskId: 7, eventId: 42, title: "T", dueDateIso: undefined });

  assert.equal(r.taskId, 99);
  assert.equal(r.eventId, undefined);
  assert.ok(!client.methods().includes("scheduleEvent"));
});

// ------------------------------------------------------- #7 close

test("close cancela el evento aunque completeTask falle (no deja recordatorios huérfanos)", async () => {
  const client = fakeClient({ fail: ["completeTask"] });
  const agenda = new WaconAgendaAdapter(client);

  await assert.rejects(() => agenda.close({ taskId: 7, eventId: 42 }), /completeTask/);
  assert.deepEqual(client.methods(), ["completeTask", "cancelEvent"], "se intentaron los dos lados");
});

test("close informa los dos fallos si los dos lados fallan", async () => {
  const client = fakeClient({ fail: ["completeTask", "cancelEvent"] });
  await assert.rejects(() => new WaconAgendaAdapter(client).close({ taskId: 7, eventId: 42 }), /completeTask.*cancelEvent/s);
});

test("close feliz no lanza", async () => {
  const client = fakeClient();
  await new WaconAgendaAdapter(client).close({ taskId: 7, eventId: 42 });
  assert.deepEqual(client.methods(), ["completeTask", "cancelEvent"]);
});

// ------------------------------------------------------- #6 brief diario

/**
 * Listener mínimo: solo lo que toca maybeSendDailyBrief.
 *
 * `hour: 0` a propósito, no la hora real de configuración (7): así el brief
 * está "vencido" a cualquier hora del día y el test no depende del reloj de la
 * máquina. Con hour 7 el test pasaba de día y fallaba de madrugada.
 */
function buildListener({ generate, notify }) {
  const logs = [];
  return new RunListenerCycle({
    logger: { log: (l) => logs.push(l) },
    notifier: { notify },
    dailyBrief: { hour: 0, generate },
    logs,
  });
}

/** Una fecha que nunca va a ser "hoy". */
const NUNCA = "2000-01-01";

test("un fallo al generar el brief NO consume el brief del día", async () => {
  const listener = buildListener({
    generate: async () => {
      throw new Error("dutic sin sesión");
    },
    notify: async () => {},
  });
  const state = { lastDailyBriefDate: NUNCA };

  assert.equal(await listener.maybeSendDailyBrief(state), false);
  assert.equal(state.lastDailyBriefDate, NUNCA, "la fecha NO se marcó: hoy todavía se puede mandar");
  assert.ok(state.lastDailyBriefAttemptTs, "quedó registrado el intento");
});

test("un fallo al MANDAR el brief tampoco consume el día", async () => {
  const listener = buildListener({
    generate: async () => "cuerpo del brief",
    notify: async () => {
      throw new Error("WhatsApp caído");
    },
  });
  const state = { lastDailyBriefDate: NUNCA };

  assert.equal(await listener.maybeSendDailyBrief(state), false);
  assert.equal(state.lastDailyBriefDate, NUNCA);
});

test("cuando el envío sale bien, se marca la fecha y no se repite", async () => {
  let enviados = 0;
  const listener = buildListener({ generate: async () => "cuerpo", notify: async () => void enviados++ });
  const state = { lastDailyBriefDate: NUNCA };

  assert.equal(await listener.maybeSendDailyBrief(state), true);
  assert.notEqual(state.lastDailyBriefDate, NUNCA);
  assert.equal(await listener.maybeSendDailyBrief(state), false, "no se manda dos veces el mismo día");
  assert.equal(enviados, 1);
});

test("tras un fallo no reintenta en el ciclo siguiente (no martilla dutic cada 20 s)", async () => {
  let intentos = 0;
  const listener = buildListener({
    generate: async () => {
      intentos++;
      throw new Error("sigue fallando");
    },
    notify: async () => {},
  });
  const state = { lastDailyBriefDate: NUNCA };

  await listener.maybeSendDailyBrief(state);
  await listener.maybeSendDailyBrief(state);
  await listener.maybeSendDailyBrief(state);
  assert.equal(intentos, 1, "los reintentos esperan el hueco configurado");
});

// ------------------------------------------------------- #8 nombres de adjunto

test("safeFileName corta los intentos de salir del directorio", () => {
  assert.equal(safeFileName("..\\..\\evil.txt"), "evil.txt");
  assert.equal(safeFileName("../../../etc/passwd"), "passwd");
  assert.equal(safeFileName("C:\\Windows\\System32\\algo.dll"), "algo.dll");
  assert.equal(safeFileName(".."), "adjunto");
  assert.equal(safeFileName("..."), "adjunto");
});

test("safeFileName saca lo que rompería la línea de comandos", () => {
  assert.equal(safeFileName('a"b.pdf'), "a_b.pdf");
  assert.equal(safeFileName("a&calc.pdf"), "a_calc.pdf");
  assert.equal(safeFileName("%PATH%.pdf"), "_PATH_.pdf");
  assert.equal(safeFileName("a|b>c.pdf"), "a_b_c.pdf");
});

test("safeFileName preserva nombres reales, con acentos y espacios", () => {
  assert.equal(safeFileName("Tarea elaboración del TIF.pdf"), "Tarea elaboración del TIF.pdf");
  assert.equal(safeFileName("Rúbrica (v2) - final.docx"), "Rúbrica (v2) - final.docx");
});

test("safeFileName maneja los casos borde", () => {
  assert.equal(safeFileName(""), "adjunto");
  assert.equal(safeFileName(null), "adjunto");
  assert.equal(safeFileName("   "), "adjunto");
  assert.equal(safeFileName("NUL"), "NUL_", "nombre de dispositivo reservado en Windows");
  assert.equal(safeFileName("con.txt"), "con_.txt");
  assert.ok(safeFileName(`${"a".repeat(400)}.pdf`).length <= 120);
  assert.ok(safeFileName(`${"a".repeat(400)}.pdf`).endsWith(".pdf"), "conserva la extensión al truncar");
});

// ------------------------------------------------------- #9 match de cursos

test("courseSimilarity puntúa el mismo curso alto y cursos distintos bajo", () => {
  assert.equal(courseSimilarity("26A ECONOMÍA: ECONOMÍA POLÍTICA (E) GA", "ECONOMIA POLITICA"), 1);
  assert.ok(courseSimilarity("MATEMÁTICAS PARA ECONOMISTAS III GA", "ESTADÍSTICA PARA ECONOMISTAS III GA") < 0.6);
  assert.ok(courseSimilarity("ECONOMÍA POLÍTICA", "ECONOMÍA GENERAL") < 0.6);
});

test("una fuente que abrevia sigue coincidiendo (se divide por el nombre más corto)", () => {
  assert.ok(sameCourse("DESARROLLO EMOCIONAL, GESTIÓN DE CONFLICTOS Y LIDERAZGO GA", "DESARROLLO EMOCIONAL"));
});

test("findBestCourseMatch elige el mejor, no el primero que comparte una palabra", () => {
  // El bug real del usuario: tiene los dos cursos, y comparten "economistas".
  const sisacad = [
    { subject: "ESTADISTICA PARA ECONOMISTAS III", weightedAverageSoFar: 8 },
    { subject: "MATEMATICAS PARA ECONOMISTAS III", weightedAverageSoFar: 17 },
  ];
  const elegido = findBestCourseMatch("26A ECONOMÍA: MATEMÁTICAS PARA ECONOMISTAS III GA", sisacad, (c) => c.subject);
  assert.equal(elegido.subject, "MATEMATICAS PARA ECONOMISTAS III");
  assert.equal(elegido.weightedAverageSoFar, 17, "no se le atribuye la nota del otro curso");
});

test("findBestCourseMatch devuelve null antes que adivinar", () => {
  assert.equal(findBestCourseMatch("MICROECONOMÍA I GA", [{ subject: "DERECHO EMPRESARIAL" }], (c) => c.subject), null);
  assert.equal(findBestCourseMatch("MICROECONOMÍA I GA", [], (c) => c.subject), null);
  assert.equal(findBestCourseMatch("MICROECONOMÍA I GA", undefined, (c) => c.subject), null);
  // Empate exacto entre dos candidatos: no hay forma de saber cuál es.
  assert.equal(
    findBestCourseMatch("ECONOMÍA POLÍTICA GA", [{ subject: "ECONOMIA POLITICA" }, { subject: "POLITICA ECONOMIA" }], (c) => c.subject),
    null,
  );
});
