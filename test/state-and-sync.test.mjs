/**
 * Cubre los cuatro arreglos de robustez del estado y del sync:
 *  1. un curso que no se pudo barrer no cierra ni re-anuncia sus tareas,
 *  2. dos procesos no se pisan el state.json (fusión por clave + runLock),
 *  3. la escritura del estado es atómica y tolera un archivo truncado,
 *  4. (indirecto) los adaptadores no bloquean el event loop — ver execDutic.
 *
 * Aísla HOME/USERPROFILE en un directorio temporal ANTES de importar nada:
 * `os.homedir()` los respeta, y de eso depende infrastructure/paths.mjs, así
 * que la suite nunca toca el ~/.dutic-wacon-bridge de verdad. Por eso todos los
 * imports del proyecto son dinámicos y van después de tocar el entorno.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const FAKE_HOME = mkdtempSync(join(tmpdir(), "dutic-wacon-test-"));
process.env.USERPROFILE = FAKE_HOME;
process.env.HOME = FAKE_HOME;
after(() => rmSync(FAKE_HOME, { recursive: true, force: true }));

const SRC = pathToFileURL(join(import.meta.dirname, "..", "src")).href;
const { FileStateRepository } = await import(`${SRC}/infrastructure/persistence/FileStateRepository.mjs`);
const { FileRunLock } = await import(`${SRC}/infrastructure/persistence/FileRunLock.mjs`);
const { withFileLock } = await import(`${SRC}/infrastructure/persistence/fileLock.mjs`);
const { SyncAcademicTasks } = await import(`${SRC}/application/use-cases/SyncAcademicTasks.mjs`);
const { BRIDGE_DIR, STATE_PATH, STATE_LOCK_PATH } = await import(`${SRC}/infrastructure/paths.mjs`);

assert.ok(BRIDGE_DIR.startsWith(FAKE_HOME), `la suite debe correr aislada, no sobre ${BRIDGE_DIR}`);
mkdirSync(BRIDGE_DIR, { recursive: true });

const reset = () => writeFileSync(STATE_PATH, "{}");
const onDisk = () => JSON.parse(readFileSync(STATE_PATH, "utf8"));

// ---------------------------------------------------------------- escritura atómica

test("save/load hace roundtrip y no deja temporales colgados", async () => {
  reset();
  const repo = new FileStateRepository();
  const state = await repo.load();
  state.tasks["111"] = { title: "T1", courseName: "CURSO A" };
  await repo.save(state);

  assert.deepEqual((await repo.load()).tasks["111"], { title: "T1", courseName: "CURSO A" });
  assert.equal(readdirSync(BRIDGE_DIR).filter((f) => f.endsWith(".tmp")).length, 0);
});

test("un state.json truncado no revienta y se recupera al siguiente save", async () => {
  writeFileSync(STATE_PATH, '{"tasks": {"111": {"tit'); // muerte a mitad de escritura
  const repo = new FileStateRepository();
  const state = await repo.load();
  assert.deepEqual(state.tasks, {}, "cae a estado vacío en vez de tirar excepción");

  state.tasks["222"] = { title: "T2" };
  await repo.save(state);
  assert.ok(onDisk().tasks["222"]);
});

// ---------------------------------------------------------------- carrera entre procesos

test("dos escritores con claves distintas no se pisan (listener vs. cron)", async () => {
  reset();
  // El sync (cron) carga el estado y se va a tardar minutos...
  const sync = new FileStateRepository();
  const syncState = await sync.load();

  // ...mientras el listener carga, escribe SUS claves y guarda.
  const listener = new FileStateRepository();
  const listenerState = await listener.load();
  listenerState.lastCommandTs = 1700000000000;
  listenerState.triggerListener = { msgCursor: 42, triggerCursor: 7 };
  await listener.save(listenerState);

  // Ahora el sync guarda su snapshot viejo, que no sabe nada del listener.
  syncState.tasks["333"] = { title: "Tarea del sync" };
  await sync.save(syncState);

  const final = onDisk();
  assert.ok(final.tasks["333"], "lo que escribió el sync sobrevive");
  assert.equal(final.lastCommandTs, 1700000000000, "lo del listener NO se pisó");
  assert.deepEqual(final.triggerListener, { msgCursor: 42, triggerCursor: 7 });
});

test("el escritor que tocó una clave gana sobre lo que había en disco", async () => {
  reset();
  const a = new FileStateRepository();
  const stateA = await a.load();

  const b = new FileStateRepository();
  const stateB = await b.load();
  stateB.tasks["viejo"] = { title: "de B" };
  await b.save(stateB);

  stateA.tasks = { nuevo: { title: "de A" } };
  await a.save(stateA);

  assert.deepEqual(Object.keys(onDisk().tasks), ["nuevo"]);
});

test("saves concurrentes sobre claves distintas se serializan y ninguno se pierde", async () => {
  reset();
  const claves = [
    "tasks",
    "gradeRisk",
    "examMaterialsFetched",
    "flaggedConflicts",
    "silentOverdueFlagged",
    "lastCommandTs",
    "lastDailyBriefDate",
    "triggerListener",
  ];
  const repos = claves.map(() => new FileStateRepository());
  const states = await Promise.all(repos.map((r) => r.load()));

  await Promise.all(
    states.map((state, i) => {
      state[claves[i]] = { escritoPor: i };
      return repos[i].save(state);
    }),
  );

  const final = onDisk();
  for (const [i, clave] of claves.entries()) assert.deepEqual(final[clave], { escritoPor: i }, `sobrevivió ${clave}`);
  assert.ok(!existsSync(STATE_LOCK_PATH), "el lock queda liberado");
});

test("sobre la MISMA clave la fusión es last-write-wins: por eso el sync necesita runLock", async () => {
  reset();
  const [a, b] = [new FileStateRepository(), new FileStateRepository()];
  const [stateA, stateB] = [await a.load(), await b.load()];
  stateB.tasks = { deB: {} };
  await b.save(stateB);
  stateA.tasks = { deA: {} };
  await a.save(stateA);
  // Contrato documentado: la fusión es por clave, no hay merge profundo.
  assert.deepEqual(Object.keys(onDisk().tasks), ["deA"]);
});

test("un lock huérfano se rompe pasado staleMs en vez de colgarse para siempre", async () => {
  mkdirSync(STATE_LOCK_PATH, { recursive: true }); // proceso muerto sin liberar
  let corrio = false;
  await withFileLock(STATE_LOCK_PATH, async () => void (corrio = true), { timeoutMs: 300, staleMs: 0 });
  assert.ok(corrio);
  assert.ok(!existsSync(STATE_LOCK_PATH));
});

test("un lock tomado y vivo respeta el timeout y avisa con código ELOCKED", async () => {
  mkdirSync(STATE_LOCK_PATH, { recursive: true });
  await assert.rejects(() => withFileLock(STATE_LOCK_PATH, async () => {}, { timeoutMs: 150, staleMs: 60_000 }), {
    code: "ELOCKED",
  });
  rmSync(STATE_LOCK_PATH, { recursive: true, force: true });
});

test("el runLock serializa corridas del mismo caso de uso", async () => {
  const lock = new FileRunLock();
  let dentro = 0;
  let maxDentro = 0;
  const corrida = () =>
    lock.withExclusiveRun("test-serializa", async () => {
      maxDentro = Math.max(maxDentro, ++dentro);
      await new Promise((r) => setTimeout(r, 120));
      dentro--;
    });

  const resultados = await Promise.allSettled([corrida(), corrida()]);
  assert.equal(maxDentro, 1, "nunca hubo dos corridas simultáneas");
  // Corridas cortas: la segunda espera su turno y entra (el timeout de espera es 2 s).
  assert.deepEqual(
    resultados.map((r) => r.status),
    ["fulfilled", "fulfilled"],
  );
});

test("si otro proceso tiene el lock más que el timeout, se rechaza con mensaje claro", async () => {
  const ajeno = join(BRIDGE_DIR, "test-ocupado.run.lock");
  mkdirSync(ajeno, { recursive: true });
  await assert.rejects(
    () => new FileRunLock().withExclusiveRun("test-ocupado", async () => {}),
    /Ya hay una corrida de "test-ocupado" en curso/,
  );
  rmSync(ajeno, { recursive: true, force: true });
});

// ---------------------------------------------------------------- scanErrors

const TASK_A = { cmid: 1, courseId: 10, courseName: "CURSO A", name: "Tarea A", submission: "not-submitted", dueDate: 2000000000 };
const PREV = {
  1: { title: "[DUTIC] CURSO A: Tarea A", courseName: "CURSO A", courseId: 10, dueDate: 2000000000, waconTaskId: "wt1", waconEventId: "we1" },
  2: { title: "[DUTIC] CURSO B: Tarea B", courseName: "CURSO B", courseId: 20, dueDate: 2000000000, waconTaskId: "wt2", waconEventId: "we2" },
};

/** Dobles de prueba de los puertos que toca SyncAcademicTasks. */
function buildDeps({ tasks, scanErrors, prevTasks }) {
  const closed = [];
  const notified = [];
  const state = { tasks: prevTasks, flaggedConflicts: [], silentOverdueFlagged: [] };
  return {
    closed,
    notified,
    state,
    deps: {
      taskSource: { listAllTasks: async () => ({ tasks, scanErrors }) },
      agenda: {
        close: async (x) => void closed.push(x),
        upsertPendingTask: async () => ({ taskId: "new-t", eventId: "new-e" }),
        reschedule: async () => ({ eventId: "re-e" }),
        flagConflict: async () => ({}),
        listSuggestedEvents: async () => [],
      },
      notifier: { notify: async (text) => void notified.push(text) },
      stateRepository: { load: async () => state, save: async () => {} },
      logger: { log: () => {} },
    },
  };
}

test("un curso que no se pudo barrer NO cierra sus tareas ni las re-anuncia", async () => {
  const { deps, closed, state } = buildDeps({
    tasks: [TASK_A],
    scanErrors: [{ courseId: 20, courseName: "CURSO B" }],
    prevTasks: structuredClone(PREV),
  });
  const r = await new SyncAcademicTasks(deps).run();

  assert.deepEqual(closed, [], "no se cerró nada en la agenda");
  assert.deepEqual(r.resolved, [], "no se reportó como resuelta");
  assert.deepEqual(r.keptUnscanned, ["[DUTIC] CURSO B: Tarea B"]);
  assert.equal(state.tasks["2"].waconTaskId, "wt2", "se preserva el tracking intacto, con sus ids de wacon");
});

test("sin scanErrors, una tarea que desaparece sí se cierra", async () => {
  const { deps, closed, state } = buildDeps({ tasks: [TASK_A], scanErrors: [], prevTasks: structuredClone(PREV) });
  const r = await new SyncAcademicTasks(deps).run();

  assert.deepEqual(closed, [{ taskId: "wt2", eventId: "we2" }]);
  assert.deepEqual(r.resolved, ["[DUTIC] CURSO B: Tarea B"]);
  assert.equal(state.tasks["2"], undefined, "deja de trackearse");
});

test("estado viejo sin courseId igual se reconoce por nombre de curso", async () => {
  const prevTasks = structuredClone(PREV);
  delete prevTasks[2].courseId; // como quedó escrito antes de este cambio
  const { deps, closed } = buildDeps({ tasks: [TASK_A], scanErrors: [{ courseName: "CURSO B" }], prevTasks });
  const r = await new SyncAcademicTasks(deps).run();

  assert.deepEqual(closed, []);
  assert.equal(r.keptUnscanned.length, 1);
});

test("una tarea entregada en un curso que SÍ se barrió se cierra aunque otro curso falle", async () => {
  const { deps, closed } = buildDeps({
    tasks: [{ ...TASK_A, submission: "submitted" }],
    scanErrors: [{ courseId: 20, courseName: "CURSO B" }],
    prevTasks: structuredClone(PREV),
  });
  const r = await new SyncAcademicTasks(deps).run();

  assert.deepEqual(closed, [{ taskId: "wt1", eventId: "we1" }], "la entregada del curso sano se cierra");
  assert.deepEqual(r.resolved, ["[DUTIC] CURSO A: Tarea A"]);
  assert.deepEqual(r.keptUnscanned, ["[DUTIC] CURSO B: Tarea B"]);
});

test("dos syncs concurrentes no se solapan (la carrera que corrompía `tasks`)", async () => {
  const { deps } = buildDeps({ tasks: [TASK_A], scanErrors: [], prevTasks: {} });
  deps.runLock = new FileRunLock();

  let dentro = 0;
  let maxDentro = 0;
  deps.taskSource.listAllTasks = async () => {
    maxDentro = Math.max(maxDentro, ++dentro);
    await new Promise((r) => setTimeout(r, 150));
    dentro--;
    return { tasks: [TASK_A], scanErrors: [] };
  };

  const sync = new SyncAcademicTasks(deps);
  await Promise.allSettled([sync.run(), sync.run()]);
  assert.equal(maxDentro, 1, "las dos corridas se serializaron");
});

test("sin runLock el caso de uso sigue corriendo (dobles de prueba)", async () => {
  const { deps } = buildDeps({ tasks: [TASK_A], scanErrors: [], prevTasks: {} });
  assert.equal(deps.runLock, undefined);
  assert.equal((await new SyncAcademicTasks(deps).run()).added.length, 1);
});
