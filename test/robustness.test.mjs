/**
 * Cubre los arreglos de robustez: cliente RPC (timeout, reconexión al daemon,
 * respuestas no-JSON), configs ilegibles, rotación del log, poda del estado y
 * conformidad del .ics con RFC 5545.
 *
 * Aísla HOME/USERPROFILE igual que las otras suites, porque acá se escriben
 * daemon.json, sync.log y configs.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const FAKE_HOME = mkdtempSync(join(tmpdir(), "dutic-wacon-robust-"));
process.env.USERPROFILE = FAKE_HOME;
process.env.HOME = FAKE_HOME;
after(() => rmSync(FAKE_HOME, { recursive: true, force: true }));

const SRC = pathToFileURL(join(import.meta.dirname, "..", "src")).href;
const { WaconDaemonClient } = await import(`${SRC}/infrastructure/wacon/WaconDaemonClient.mjs`);
const { FileCourseGroupMap, COURSE_GROUP_MAP_PATH } = await import(`${SRC}/infrastructure/persistence/FileCourseGroupMap.mjs`);
const { FileTargetChatConfig, CONFIG_PATH } = await import(`${SRC}/infrastructure/persistence/FileTargetChatConfig.mjs`);
const { ConsoleFileLogger } = await import(`${SRC}/infrastructure/logging/ConsoleFileLogger.mjs`);
const { buildIcs } = await import(`${SRC}/domain/services/IcsBuilder.mjs`);
const { SyncAcademicTasks } = await import(`${SRC}/application/use-cases/SyncAcademicTasks.mjs`);
const { PrefetchExamMaterials } = await import(`${SRC}/application/use-cases/PrefetchExamMaterials.mjs`);
const { BRIDGE_DIR, LOG_PATH, WACON_DAEMON_INFO_PATH } = await import(`${SRC}/infrastructure/paths.mjs`);

assert.ok(BRIDGE_DIR.startsWith(FAKE_HOME), "la suite debe correr aislada");
mkdirSync(BRIDGE_DIR, { recursive: true });
mkdirSync(join(FAKE_HOME, ".wacon"), { recursive: true });

const silentLogger = { log: () => {} };

// ---------------------------------------------------------------- cliente RPC

/**
 * Daemon de wacon de mentira. `handler` decide qué contestar; se le pasa el
 * cuerpo ya parseado y el request, para poder simular 401, HTML, colgarse, etc.
 */
async function fakeDaemon(handler) {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => handler({ body: JSON.parse(raw || "{}"), req, res }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(null)));
  const address = /** @type {import("node:net").AddressInfo} */ (server.address());
  return { port: address.port, close: () => new Promise((r) => server.close(r)) };
}

/** Escribe daemon.json donde el cliente lo va a buscar. */
function writeDaemonInfo(port, token = "tok") {
  writeFileSync(WACON_DAEMON_INFO_PATH, JSON.stringify({ port, token }));
}

/** Cliente con `info` ya cargada, para no depender de que exista el CLI `wacon`. */
function clientFor(port, token = "tok") {
  const client = new WaconDaemonClient(silentLogger);
  client.info = { port, token };
  return client;
}

test("una respuesta que no es JSON da un error que dice qué pasó, no un error de parseo", async () => {
  const daemon = await fakeDaemon(({ res }) => {
    res.writeHead(500, { "content-type": "text/html" });
    res.end("<html>Internal Server Error</html>");
  });
  after(() => daemon.close());

  await assert.rejects(() => clientFor(daemon.port).rpc("status"), /respuesta no-JSON \(HTTP 500\).*Internal Server Error/s);
});

test("un cuerpo vacío con 200 no revienta", async () => {
  const daemon = await fakeDaemon(({ res }) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("");
  });
  after(() => daemon.close());

  assert.equal(await clientFor(daemon.port).rpc("status"), undefined);
});

test("un daemon que no contesta corta por timeout en vez de colgarse para siempre", async () => {
  const daemon = await fakeDaemon(() => {
    /* nunca responde */
  });
  after(() => daemon.close());

  const t0 = Date.now();
  await assert.rejects(() => clientFor(daemon.port).rpc("status", [], { timeoutMs: 250 }), /no contestó en 250 ms/);
  assert.ok(Date.now() - t0 < 3000, "cortó rápido");
});

test("un timeout NO se reintenta: la llamada pudo haber llegado y `send` no es idempotente", async () => {
  let recibidas = 0;
  const daemon = await fakeDaemon(() => void recibidas++); // recibe y no contesta
  after(() => daemon.close());

  const client = clientFor(daemon.port);
  // ensureDaemon fallaría (no hay CLI wacon en el test) — si intentara reintentar,
  // el error sería otro. Que el mensaje siga siendo el de timeout prueba que no reintentó.
  await assert.rejects(() => client.rpc("send", ["jid", "hola"], { timeoutMs: 200 }), /no contestó en 200 ms/);
  assert.equal(recibidas, 1, "se mandó una sola vez");
});

test("si el daemon reinició en otro puerto, se relee daemon.json y se reintenta", async () => {
  const viejo = await fakeDaemon(({ res }) => res.end("{}"));
  const puertoViejo = viejo.port;
  await viejo.close(); // el daemon "murió": nadie escucha en ese puerto

  let atendidas = 0;
  const nuevo = await fakeDaemon(({ res }) => {
    atendidas++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ result: { ok: true } }));
  });
  after(() => nuevo.close());

  // daemon.json ya apunta al nuevo, como haría wacon al reiniciar.
  writeDaemonInfo(nuevo.port);
  const client = clientFor(puertoViejo);
  // ensureDaemon corre `wacon status`; si el CLI no existe acá, no se puede probar
  // el camino completo, así que se sustituye por la relectura del archivo, que es
  // lo que se está verificando.
  client.ensureDaemon = async () => {
    client.info = JSON.parse(readFileSync(WACON_DAEMON_INFO_PATH, "utf8"));
    return client.info;
  };

  assert.deepEqual(await client.rpc("status"), { ok: true });
  assert.equal(atendidas, 1, "el reintento fue al puerto nuevo");
});

test("un 401 (token viejo) también dispara la reconexión", async () => {
  let intentos = 0;
  const daemon = await fakeDaemon(({ req, res }) => {
    intentos++;
    if (req.headers.authorization !== "Bearer nuevo") {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "token inválido" }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ result: "listo" }));
  });
  after(() => daemon.close());

  writeDaemonInfo(daemon.port, "nuevo");
  const client = clientFor(daemon.port, "viejo");
  client.ensureDaemon = async () => {
    client.info = JSON.parse(readFileSync(WACON_DAEMON_INFO_PATH, "utf8"));
    return client.info;
  };

  assert.equal(await client.rpc("status"), "listo");
  assert.equal(intentos, 2);
});

test("un error de negocio del daemon (400) NO se reintenta", async () => {
  let intentos = 0;
  const daemon = await fakeDaemon(({ res }) => {
    intentos++;
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "chat inexistente" }));
  });
  after(() => daemon.close());

  await assert.rejects(() => clientFor(daemon.port).rpc("send", ["nope"]), /chat inexistente/);
  assert.equal(intentos, 1);
});

// ---------------------------------------------------------------- configs ilegibles

test("un course-groups.json roto se trata como 'curso no mapeado', no revienta", async () => {
  writeFileSync(COURSE_GROUP_MAP_PATH, "{ esto no es json");
  const avisos = [];
  const map = new FileCourseGroupMap({ log: (l) => avisos.push(l) });

  assert.equal(await map.getChatForCourse(2279), null);
  assert.match(avisos[0], /course-groups\.json ilegible/);
});

test("un config.json roto cae al chat propio en vez de tumbar el notify", async () => {
  writeFileSync(CONFIG_PATH, "}{");
  const avisos = [];
  const config = new FileTargetChatConfig({ getSelfJid: async () => "yo@s.whatsapp.net" }, { log: (l) => avisos.push(l) });

  assert.equal(await config.getChatJid(), "yo@s.whatsapp.net");
  assert.match(avisos[0], /config\.json ilegible/);
});

test("un config.json válido sigue mandando", async () => {
  writeFileSync(CONFIG_PATH, JSON.stringify({ commandChatJid: "grupo@g.us" }));
  const config = new FileTargetChatConfig({ getSelfJid: async () => "yo@s.whatsapp.net" }, silentLogger);
  assert.equal(await config.getChatJid(), "grupo@g.us");
});

// ---------------------------------------------------------------- rotación del log

test("sync.log rota al pasar el techo y conserva una generación", () => {
  rmSync(LOG_PATH, { force: true });
  rmSync(`${LOG_PATH}.1`, { force: true });

  writeFileSync(LOG_PATH, "x".repeat(6 * 1024 * 1024)); // pasado el máximo de 5 MB
  new ConsoleFileLogger().log("linea nueva");

  assert.ok(statSync(`${LOG_PATH}.1`).size > 5 * 1024 * 1024, "el viejo quedó como .1");
  const actual = readFileSync(LOG_PATH, "utf8");
  assert.match(actual, /linea nueva/);
  assert.ok(actual.length < 1000, "el nuevo arranca limpio");
});

// ---------------------------------------------------------------- poda del estado

const TASK = { cmid: 1, courseId: 10, courseName: "CURSO A", name: "Tarea A", submission: "not-submitted", dueDate: 4000000000 };

function syncDeps({ tasks, scanErrors, state }) {
  return {
    taskSource: { listAllTasks: async () => ({ tasks, scanErrors }) },
    agenda: {
      close: async () => {},
      upsertPendingTask: async () => ({ taskId: "t", eventId: "e" }),
      reschedule: async () => ({}),
      flagConflict: async () => ({}),
      listSuggestedEvents: async () => [],
    },
    notifier: { notify: async () => {} },
    stateRepository: { load: async () => state, save: async () => {} },
    logger: silentLogger,
  };
}

test("las marcas de tareas que ya no existen se descartan (el estado no crece para siempre)", async () => {
  const state = {
    tasks: {},
    flaggedConflicts: ["1:ev9", "999:ev1", "888:ev2"],
    silentOverdueFlagged: ["1", "999"],
  };
  await new SyncAcademicTasks(syncDeps({ tasks: [TASK], scanErrors: [], state })).run();

  assert.deepEqual(state.flaggedConflicts, ["1:ev9"], "solo sobreviven las de tareas vigentes");
  assert.deepEqual(state.silentOverdueFlagged, ["1"]);
});

test("no se poda nada si un curso no se pudo barrer (si no, se re-avisaría el mismo conflicto)", async () => {
  const state = {
    tasks: {},
    flaggedConflicts: ["1:ev9", "999:ev1"],
    silentOverdueFlagged: ["999"],
  };
  await new SyncAcademicTasks(syncDeps({ tasks: [TASK], scanErrors: [{ courseId: 20, courseName: "CURSO B" }], state })).run();

  assert.deepEqual(state.flaggedConflicts, ["1:ev9", "999:ev1"], "se conservan intactas");
  assert.deepEqual(state.silentOverdueFlagged, ["999"]);
});

test("examMaterialsFetched también se poda, y no cuando hay scanErrors", async () => {
  const base = () => ({
    materials: { prepareCourseMaterials: async () => ({ dest: "d", summary: "s" }) },
    notifier: { notify: async () => {} },
    logger: silentLogger,
    destDir: "d",
  });

  const state = { examMaterialsFetched: ["1", "999"] };
  await new PrefetchExamMaterials({
    ...base(),
    taskSource: { listAllTasks: async () => ({ tasks: [TASK], scanErrors: [] }) },
    stateRepository: { load: async () => state, save: async () => {} },
  }).run();
  assert.deepEqual(state.examMaterialsFetched, ["1"]);

  const state2 = { examMaterialsFetched: ["1", "999"] };
  await new PrefetchExamMaterials({
    ...base(),
    taskSource: { listAllTasks: async () => ({ tasks: [TASK], scanErrors: [{ courseId: 20 }] }) },
    stateRepository: { load: async () => state2, save: async () => {} },
  }).run();
  assert.deepEqual(state2.examMaterialsFetched, ["1", "999"], "con datos parciales no se poda");
});

// ---------------------------------------------------------------- .ics

const TAREA_ICS = {
  cmid: 42,
  courseName: "26A ECONOMÍA: DESARROLLO EMOCIONAL, GESTIÓN DE CONFLICTOS Y LIDERAZGO GA",
  name: "Entrega del trabajo integrador final, con rúbrica y anexos incluidos",
  dueDate: 1785000000,
  description: "Línea uno\nLínea dos; con punto y coma, y coma",
  url: "https://dutic.unsa.edu.pe/mod/assign/view.php?id=999",
};

/** Deshace el plegado, para poder verificar el contenido lógico. */
function unfold(ics) {
  return ics.replace(/\r\n /g, "");
}

test("cada VEVENT tiene DTEND (sin él, los importadores lo tratan de forma inconsistente)", () => {
  const ics = unfold(buildIcs([TAREA_ICS], { now: 0 }));
  // dueDate 1785000000 (epoch en segundos) = 2026-07-25T17:20:00Z
  assert.match(ics, /DTSTART:20260725T172000Z/);
  assert.match(ics, /DTEND:20260725T175000Z/, "media hora después del vencimiento");
});

test("ninguna línea pasa de 75 octetos, y el UTF-8 queda válido", () => {
  const ics = buildIcs([TAREA_ICS], { now: 0 });
  for (const line of ics.split("\r\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, `línea de ${Buffer.byteLength(line, "utf8")} octetos: ${line}`);
  }
  // Si el plegado hubiera partido un carácter multibyte, al deshacerlo aparecería U+FFFD.
  assert.ok(!unfold(ics).includes("�"), "no se partió ningún carácter multibyte");
  assert.match(unfold(ics), /SUMMARY:26A ECONOMÍA: DESARROLLO EMOCIONAL/);
  assert.ok(unfold(ics).includes("LIDERAZGO GA: Entrega del trabajo integrador final"), "el summary completo sobrevive al plegado");
});

test("el escapado de RFC 5545 se mantiene", () => {
  const ics = unfold(buildIcs([TAREA_ICS], { now: 0 }));
  assert.match(ics, /DESCRIPTION:Línea uno\\nLínea dos\\; con punto y coma\\, y coma/);
});

test("se incluye un recordatorio (VALARM) 24h antes, desactivable", () => {
  assert.match(unfold(buildIcs([TAREA_ICS], { now: 0 })), /BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT1440M/);
  assert.ok(!buildIcs([TAREA_ICS], { now: 0, alarmMinutesBefore: 0 }).includes("VALARM"));
});

test("las tareas sin fecha se omiten y el calendario sigue siendo válido", () => {
  const ics = buildIcs([{ cmid: 1, courseName: "C", name: "sin fecha" }], { now: 0 });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR"));
  assert.ok(ics.endsWith("END:VCALENDAR"));
  assert.ok(!ics.includes("BEGIN:VEVENT"));
});

test("los caracteres de control que vengan en la consigna no rompen el archivo", () => {
  const sucia = { ...TAREA_ICS, description: `antes${String.fromCharCode(0)}${String.fromCharCode(7)}después` };
  const ics = unfold(buildIcs([sucia], { now: 0 }));
  assert.match(ics, /DESCRIPTION:antesdespués/);
});
