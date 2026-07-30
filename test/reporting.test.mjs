/**
 * Lo que el bridge te cuenta y lo que te calla: tareas cuyo estado no se pudo
 * leer (antes desaparecían), avisos de fallo repetidos (antes uno por corrida)
 * y los ajustes de config.json.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const FAKE_HOME = mkdtempSync(join(tmpdir(), "dutic-wacon-report-"));
process.env.USERPROFILE = FAKE_HOME;
process.env.HOME = FAKE_HOME;
after(() => rmSync(FAKE_HOME, { recursive: true, force: true }));

const SRC = pathToFileURL(join(import.meta.dirname, "..", "src")).href;
const { SyncAcademicTasks } = await import(`${SRC}/application/use-cases/SyncAcademicTasks.mjs`);
const { GetUnifiedBrief } = await import(`${SRC}/application/use-cases/GetUnifiedBrief.mjs`);
const { loadSettings, DEFAULT_SETTINGS, CONFIG_PATH } = await import(`${SRC}/infrastructure/persistence/FileSettings.mjs`);
const { BRIDGE_DIR } = await import(`${SRC}/infrastructure/paths.mjs`);

assert.ok(BRIDGE_DIR.startsWith(FAKE_HOME), "la suite debe correr aislada");
mkdirSync(BRIDGE_DIR, { recursive: true });

const silentLogger = { log: () => {} };

const PENDIENTE = { cmid: 1, courseId: 10, courseName: "CURSO A", name: "Tarea A", submission: "not-submitted", dueDate: 4000000000 };
const ILEGIBLE = { cmid: 2, courseId: 10, courseName: "CURSO A", name: "Tarea rara", submission: "unknown", dueDate: 4000000000 };

/**
 * Repositorio de estado en memoria que sí persiste entre llamadas.
 * @param {Record<string, any>} [initial]
 */
function memoryState(initial = {}) {
  /** @type {Record<string, any>} */
  const state = { tasks: {}, flaggedConflicts: [], silentOverdueFlagged: [], ...initial };
  return { state, load: async () => state, save: async () => {} };
}

/** @param {Record<string, any>} [opts] */
function buildSync({ tasks = [], scanErrors = [], repo = memoryState(), listAllTasks, ...extra } = {}) {
  const notified = [];
  const deps = {
    taskSource: { listAllTasks: listAllTasks ?? (async () => ({ tasks, scanErrors })) },
    agenda: {
      close: async () => {},
      upsertPendingTask: async () => ({ taskId: "t", eventId: "e" }),
      reschedule: async () => ({}),
      flagConflict: async () => ({}),
      listSuggestedEvents: async () => [],
    },
    notifier: { notify: async (text) => void notified.push(text) },
    stateRepository: repo,
    logger: silentLogger,
    ...extra,
  };
  return { notified, repo, sync: new SyncAcademicTasks(deps) };
}

// ------------------------------------------------- tareas sin estado legible

test("una tarea cuyo estado no se pudo leer se cuenta y se avisa (antes desaparecía)", async () => {
  const { sync, notified, repo } = buildSync({ tasks: [PENDIENTE, ILEGIBLE] });
  const r = await sync.run();

  assert.equal(r.unknownState.length, 1);
  assert.equal(r.unknownState[0].name, "Tarea rara");
  assert.equal(r.newUnknownState.length, 1);
  assert.ok(
    notified.some((t) => t.includes("No se pudo leer si están entregadas") && t.includes("Tarea rara")),
    `no se avisó; mensajes: ${JSON.stringify(notified)}`,
  );
  assert.deepEqual(repo.state.unknownStateFlagged, ["2"]);
});

test("no se repite el aviso en cada corrida por la misma tarea", async () => {
  const repo = memoryState();
  const primera = buildSync({ tasks: [PENDIENTE, ILEGIBLE], repo });
  await primera.sync.run();

  const segunda = buildSync({ tasks: [PENDIENTE, ILEGIBLE], repo });
  const r = await segunda.sync.run();

  assert.equal(r.unknownState.length, 1, "sigue contándose");
  assert.equal(r.newUnknownState.length, 0, "pero ya no es novedad");
  assert.equal(
    segunda.notified.filter((t) => t.includes("No se pudo leer")).length,
    0,
    "no se manda un segundo WhatsApp por lo mismo",
  );
});

test("si la tarea vuelve a leerse bien, la marca se suelta y podría volver a avisar", async () => {
  const repo = memoryState();
  await buildSync({ tasks: [ILEGIBLE], repo }).sync.run();
  assert.deepEqual(repo.state.unknownStateFlagged, ["2"]);

  // Ahora sí se pudo leer: quedó como entregada.
  await buildSync({ tasks: [{ ...ILEGIBLE, submission: "submitted" }], repo }).sync.run();
  assert.deepEqual(repo.state.unknownStateFlagged, [], "se destilda sola");

  const tercera = buildSync({ tasks: [ILEGIBLE], repo });
  const r = await tercera.sync.run();
  assert.equal(r.newUnknownState.length, 1, "si vuelve a fallar, vuelve a avisar");
});

test("con datos parciales las marcas sólo se agregan, nunca se sueltan", async () => {
  const repo = memoryState();
  await buildSync({ tasks: [ILEGIBLE], repo }).sync.run();

  // Corrida con un curso caído: la tarea ilegible ni siquiera aparece.
  await buildSync({ tasks: [], scanErrors: [{ courseId: 10, courseName: "CURSO A" }], repo }).sync.run();
  assert.deepEqual(repo.state.unknownStateFlagged, ["2"], "no se suelta por datos incompletos");
});

test("el brief también las muestra, separadas de las pendientes", async () => {
  const brief = new GetUnifiedBrief({
    taskSource: { listAllTasks: async () => ({ tasks: [PENDIENTE, ILEGIBLE], scanErrors: [] }) },
    gradesSource: { listAllCourseGrades: async () => [] },
    sisacadSource: { loadCaptured: async () => null },
    agenda: { listSuggestedEvents: async () => [] },
    socialBriefing: null,
    logger: silentLogger,
  });
  const r = await brief.run();

  assert.equal(r.pendingTasks.length, 1, "la ilegible no se cuela como pendiente");
  assert.equal(r.unknownState.length, 1);
  assert.equal(r.unknownState[0].name, "Tarea rara");
});

// ------------------------------------------------- avisos de fallo

const fallar = (mensaje) => async () => {
  throw new Error(mensaje);
};

test("el primer fallo avisa", async () => {
  const { sync, notified, repo } = buildSync({ listAllTasks: fallar("La sesión de Moodle caducó") });

  await assert.rejects(() => sync.run(), /caducó/);
  assert.equal(notified.length, 1);
  assert.match(notified[0], /No se pudo sincronizar/);
  assert.equal(repo.state.syncFailure.failureCount, 1);
});

test("el mismo fallo no vuelve a avisar dentro del cooldown", async () => {
  const repo = memoryState();
  const primera = buildSync({ listAllTasks: fallar("La sesión de Moodle caducó"), repo });
  await assert.rejects(() => primera.sync.run());

  for (let i = 0; i < 4; i++) {
    const otra = buildSync({ listAllTasks: fallar("La sesión de Moodle caducó"), repo });
    await assert.rejects(() => otra.sync.run());
    assert.equal(otra.notified.length, 0, "cada corrida siguiente no manda nada");
  }
  assert.equal(repo.state.syncFailure.failureCount, 5, "pero se sigue contando");
});

test("un fallo DISTINTO sí avisa aunque el anterior esté en cooldown", async () => {
  const repo = memoryState();
  await assert.rejects(() => buildSync({ listAllTasks: fallar("La sesión de Moodle caducó"), repo }).sync.run());

  const otro = buildSync({ listAllTasks: fallar("ETIMEDOUT conectando a Moodle"), repo });
  await assert.rejects(() => otro.sync.run());
  assert.equal(otro.notified.length, 1, "es otra causa, hay que enterarse");
  assert.equal(repo.state.syncFailure.failureCount, 1, "el contador arranca de nuevo");
});

test("pasado el cooldown se vuelve a avisar, diciendo desde cuándo falla", async () => {
  const repo = memoryState();
  await assert.rejects(() => buildSync({ listAllTasks: fallar("mismo error"), repo }).sync.run());

  const vencido = buildSync({ listAllTasks: fallar("mismo error"), repo, failureNotifyCooldownMs: 0 });
  await assert.rejects(() => vencido.sync.run());
  assert.equal(vencido.notified.length, 1);
  assert.match(vencido.notified[0], /Falla desde .*2 intentos/s);
});

test("cuando se recupera, avisa", async () => {
  const repo = memoryState();
  await assert.rejects(() => buildSync({ listAllTasks: fallar("La sesión de Moodle caducó"), repo }).sync.run());

  const buena = buildSync({ tasks: [PENDIENTE], repo });
  await buena.sync.run();

  assert.ok(buena.notified.some((t) => t.includes("volvió a funcionar")), `mensajes: ${JSON.stringify(buena.notified)}`);
  assert.equal(repo.state.syncFailure, undefined, "se limpia la marca");
});

test("una corrida sana sin fallo previo no anuncia ninguna recuperación", async () => {
  const { sync, notified } = buildSync({ tasks: [PENDIENTE] });
  await sync.run();
  assert.equal(notified.filter((t) => t.includes("volvió a funcionar")).length, 0);
});

// ------------------------------------------------- ajustes

test("sin config.json se escribe el archivo con los defaults documentados", () => {
  rmSync(CONFIG_PATH, { force: true });
  const settings = loadSettings(silentLogger);

  assert.deepEqual(settings, DEFAULT_SETTINGS);
  const escrito = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  assert.equal(escrito.dailyBriefHour, 7);
  assert.ok(escrito._readme_ajustes.includes("dailyBriefHour"), "queda explicado en el archivo");
});

test("los valores del usuario mandan sobre los defaults", () => {
  writeFileSync(CONFIG_PATH, JSON.stringify({ dailyBriefHour: 6, examDaysBefore: 10, commandChatJid: "g@g.us" }));
  const settings = loadSettings(silentLogger);

  assert.equal(settings.dailyBriefHour, 6);
  assert.equal(settings.examDaysBefore, 10);
  assert.equal(settings.commandChatJid, "g@g.us");
  assert.equal(settings.reminderMinutesBefore, DEFAULT_SETTINGS.reminderMinutesBefore, "lo no configurado mantiene el default");
});

test("a un config.json viejo se le agregan los ajustes nuevos sin pisar lo suyo", () => {
  writeFileSync(CONFIG_PATH, JSON.stringify({ commandChatJid: "mio@g.us", dailyBriefHour: 5 }));
  loadSettings(silentLogger);

  const escrito = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  assert.equal(escrito.commandChatJid, "mio@g.us", "lo que ya estaba se respeta");
  assert.equal(escrito.dailyBriefHour, 5);
  assert.equal(escrito.examDaysBefore, DEFAULT_SETTINGS.examDaysBefore, "y aparecen los nuevos");
  assert.ok(escrito._readme_ajustes);
});

test("un valor absurdo se ignora en vez de romper el arranque", () => {
  writeFileSync(CONFIG_PATH, JSON.stringify({ dailyBriefHour: 99, examDaysBefore: -3, sourceCacheSeconds: "muchos" }));
  const settings = loadSettings(silentLogger);

  assert.equal(settings.dailyBriefHour, DEFAULT_SETTINGS.dailyBriefHour);
  assert.equal(settings.examDaysBefore, DEFAULT_SETTINGS.examDaysBefore);
  assert.equal(settings.sourceCacheSeconds, DEFAULT_SETTINGS.sourceCacheSeconds);
});

test("un config.json roto cae a los defaults y lo dice", () => {
  writeFileSync(CONFIG_PATH, "{{{");
  const avisos = [];
  const settings = loadSettings({ log: (l) => avisos.push(l) });

  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.match(avisos[0], /config\.json ilegible/);
});
