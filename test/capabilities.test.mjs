/**
 * Las capacidades nuevas: oír (o admitir que no se puede oír) el grupo del
 * curso, avisar notas nuevas, proponer el mapeo curso↔grupo, reconciliar la
 * agenda y buscar en el historial.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = pathToFileURL(join(import.meta.dirname, "..", "src")).href;
const { ExplainSilentOverdue } = await import(`${SRC}/application/use-cases/ExplainSilentOverdue.mjs`);
const { ReportAcademicChanges } = await import(`${SRC}/application/use-cases/ReportAcademicChanges.mjs`);
const { SuggestCourseGroups, MapCourseGroup } = await import(`${SRC}/application/use-cases/SuggestCourseGroups.mjs`);
const { ReconcileAgenda } = await import(`${SRC}/application/use-cases/ReconcileAgenda.mjs`);
const { SearchCourseChat } = await import(`${SRC}/application/use-cases/SearchCourseChat.mjs`);
const { messagesAroundDue, splitByReadability } = await import(`${SRC}/domain/services/ChatterWindow.mjs`);
const { WaconMediaReaderAdapter } = await import(`${SRC}/infrastructure/wacon/WaconMediaReaderAdapter.mjs`);

const silentLogger = { log: () => {} };
const VENCE = Math.floor(Date.UTC(2026, 6, 10, 5, 0, 0) / 1000);
const díasDesdeVencimiento = (d) => VENCE * 1000 + d * 86_400_000;

// ---------------------------------------------------------- ventana de mensajes

test("la ventana recorta a los días alrededor del vencimiento", () => {
  const mensajes = [
    { id: "viejo", timestamp: díasDesdeVencimiento(-20), text: "hola" },
    { id: "antes", timestamp: díasDesdeVencimiento(-2), text: "che" },
    { id: "justo", timestamp: díasDesdeVencimiento(0), text: "hoy" },
    { id: "despues", timestamp: díasDesdeVencimiento(1), text: "ok" },
    { id: "lejos", timestamp: díasDesdeVencimiento(10), text: "otra cosa" },
  ];
  assert.deepEqual(messagesAroundDue(mensajes, VENCE).map((m) => m.id), ["antes", "justo", "despues"]);
});

test("sin fecha de vencimiento no hay ventana que mirar", () => {
  assert.deepEqual(messagesAroundDue([{ timestamp: 1, text: "x" }], null), []);
});

test("separa lo legible de lo que no tiene texto", () => {
  const { text, media } = splitByReadability([
    { id: "1", text: "hola", type: null },
    { id: "2", text: "", type: "audio" },
    { id: "3", text: null, type: "image" },
    { id: "4", text: null, type: "sticker" },
    { id: "5", text: "   ", type: "video" },
  ]);
  assert.deepEqual(text.map((m) => m.id), ["1"]);
  assert.deepEqual(media.map((m) => m.id), ["2", "3"], "sólo audio e imagen son leíbles en principio");
});

// ---------------------------------------------------------- vencidas en silencio

const TAREA = { cmid: 1, courseId: 10, courseName: "CURSO A", name: "Práctica 4", dueDate: VENCE };

/** @param {{mensajes?:any[], jid?:string, media?:any}} [opts] */
function buildExplainer({ mensajes = [], jid = "grupo@g.us", media } = {}) {
  return new ExplainSilentOverdue({
    courseGroupMap: { getChatForCourse: async () => jid },
    messageHistory: { readRecent: async () => mensajes },
    mediaReader: media,
    logger: silentLogger,
  });
}

test("una prórroga escrita en el grupo deja de contar como silencio", async () => {
  const explainer = buildExplainer({
    mensajes: [{ id: "m1", timestamp: díasDesdeVencimiento(-1), text: "el profe dijo que se extiende hasta el lunes", type: null }],
  });
  const [r] = await explainer.run([{ task: TAREA, silent: true }]);

  assert.equal(r.explained, true);
  assert.equal(r.source, "texto");
  assert.match(r.evidence, /se extiende/);
});

test("un audio que NO se puede leer no es silencio: se reporta como duda", async () => {
  const explainer = buildExplainer({
    mensajes: [
      { id: "a1", timestamp: díasDesdeVencimiento(-1), text: null, type: "audio" },
      { id: "a2", timestamp: díasDesdeVencimiento(0), text: null, type: "image" },
    ],
    // Lo que devuelve wacon cuando no hay backend de transcripción configurado.
    media: { readMedia: async () => ({ readable: false, text: null, reason: "sin backend" }) },
  });
  const [r] = await explainer.run([{ task: TAREA, silent: true }]);

  assert.equal(r.explained, false, "no podemos afirmar que se explicó");
  assert.equal(r.unreadableMedia, 2, "pero tampoco que nadie dijo nada");
});

test("con transcripción disponible, una prórroga dicha en audio sí se detecta", async () => {
  const explainer = buildExplainer({
    mensajes: [{ id: "a1", timestamp: díasDesdeVencimiento(-1), text: null, type: "audio" }],
    media: { readMedia: async () => ({ readable: true, text: "chicos, la nueva fecha es el viernes" }) },
  });
  const [r] = await explainer.run([{ task: TAREA, silent: true }]);

  assert.equal(r.explained, true);
  assert.equal(r.source, "audio");
});

test("silencio de verdad sigue siendo silencio", async () => {
  const explainer = buildExplainer({
    mensajes: [{ id: "m1", timestamp: díasDesdeVencimiento(-1), text: "alguien tiene el link del zoom?", type: null }],
  });
  const [r] = await explainer.run([{ task: TAREA, silent: true }]);

  assert.equal(r.explained, false);
  assert.equal(r.unreadableMedia, 0);
  assert.equal(r.messagesInWindow, 1);
});

test("un curso sin grupo mapeado se marca como no inspeccionado, no como silencio confirmado", async () => {
  const explainer = new ExplainSilentOverdue({
    courseGroupMap: { getChatForCourse: async () => null },
    messageHistory: { readRecent: async () => [] },
    logger: silentLogger,
  });
  const [r] = await explainer.run([{ task: TAREA, silent: true }]);
  assert.equal(r.inspected, false);
});

test("si leer el grupo falla, la tarea queda como estaba en vez de romper el sync", async () => {
  const explainer = new ExplainSilentOverdue({
    courseGroupMap: { getChatForCourse: async () => "g@g.us" },
    messageHistory: {
      readRecent: async () => {
        throw new Error("wacon caído");
      },
    },
    logger: silentLogger,
  });
  const [r] = await explainer.run([{ task: TAREA, silent: true }]);
  assert.equal(r.inspected, false);
  assert.equal(r.task.name, "Práctica 4");
});

test("el lector de medios traduce los dos modos de wacon", async () => {
  const conBackend = new WaconMediaReaderAdapter({ rpc: async () => ({ ok: true, mode: "transcript", text: "hola" }) }, silentLogger);
  assert.deepEqual(await conBackend.readMedia({ chatJid: "g", messageId: "1", type: "audio" }), { readable: true, text: "hola" });

  // Sin backend, wacon devuelve el audio crudo para que lo escuche un agente:
  // este bridge no puede, y eso es exactamente lo que hay que reportar.
  const sinBackend = new WaconMediaReaderAdapter({ rpc: async () => ({ ok: true, mode: "audio-block", base64: "AAA", mimetype: "audio/ogg" }) }, silentLogger);
  const r = await sinBackend.readMedia({ chatJid: "g", messageId: "1", type: "audio" });
  assert.equal(r.readable, false);
  assert.match(r.reason, /backend de transcripción/);
});

// ---------------------------------------------------------- novedades académicas

const SIN_CAMBIOS = { firstRun: false, previousAt: 1, newTasks: [], submissionChanges: [], dueDateChanges: [], newGrades: [], gradeChanges: [] };

test("una nota nueva se avisa con el ítem y la nota", async () => {
  const notified = [];
  const r = await new ReportAcademicChanges({
    academicChanges: { pullChanges: async () => ({ ...SIN_CAMBIOS, newGrades: [{ courseName: "MICRO I", item: "Práctica 1", grade: "16,00" }] }) },
    notifier: { notify: async (t) => void notified.push(t) },
    logger: silentLogger,
  }).run();

  assert.equal(r.notified, true);
  assert.match(notified[0], /Notas nuevas/);
  assert.match(notified[0], /MICRO I — Práctica 1: \*16,00\*/);
});

test("sin novedades no se manda nada", async () => {
  const notified = [];
  const r = await new ReportAcademicChanges({
    academicChanges: { pullChanges: async () => SIN_CAMBIOS },
    notifier: { notify: async (t) => void notified.push(t) },
    logger: silentLogger,
  }).run();

  assert.equal(r.notified, false);
  assert.equal(notified.length, 0);
});

test("la primera corrida sólo guarda la línea base", async () => {
  const notified = [];
  const r = await new ReportAcademicChanges({
    academicChanges: { pullChanges: async () => ({ ...SIN_CAMBIOS, firstRun: true, previousAt: null }) },
    notifier: { notify: async (t) => void notified.push(t) },
    logger: silentLogger,
  }).run();

  assert.equal(r.notified, false);
  assert.equal(notified.length, 0);
});

// ---------------------------------------------------------- mapeo curso ↔ grupo

const CURSOS = [
  { courseId: 2279, courseName: "26A ECONOMÍA: ECONOMÍA POLÍTICA (E) GA" },
  { courseId: 2271, courseName: "26A ECONOMÍA: ESTADÍSTICA PARA ECONOMISTAS III GA" },
];

test("dice qué está mapeado y propone lo que falta", async () => {
  const r = await new SuggestCourseGroups({
    coursesSource: { listCourses: async () => CURSOS },
    chatDirectory: {
      listChats: async () => [
        { jid: "eco@g.us", name: "Economía Política 2026", isGroup: true },
        { jid: "est@g.us", name: "Estadística para Economistas III", isGroup: true },
        { jid: "yo@s.whatsapp.net", name: "Mamá", isGroup: false },
      ],
    },
    courseGroupMap: { listMappings: async () => ({ 2279: "eco@g.us" }) },
    logger: silentLogger,
  }).run();

  assert.equal(r.mapped.length, 1);
  assert.equal(r.mapped[0].groupName, "Economía Política 2026");
  assert.equal(r.unmapped.length, 1);
  assert.equal(r.unmapped[0].courseId, 2271);
  assert.equal(r.unmapped[0].suggestion.jid, "est@g.us");
});

test("un grupo ya usado por otro curso no se propone de nuevo", async () => {
  const r = await new SuggestCourseGroups({
    coursesSource: { listCourses: async () => CURSOS },
    chatDirectory: { listChats: async () => [{ jid: "eco@g.us", name: "Economía Política 2026", isGroup: true }] },
    courseGroupMap: { listMappings: async () => ({ 2279: "eco@g.us" }) },
    logger: silentLogger,
  }).run();

  assert.equal(r.unmapped[0].suggestion, null, "el único grupo ya está tomado");
});

test("no se propone nada si ningún nombre se parece", async () => {
  const r = await new SuggestCourseGroups({
    coursesSource: { listCourses: async () => [CURSOS[0]] },
    chatDirectory: { listChats: async () => [{ jid: "x@g.us", name: "Fútbol domingos", isGroup: true }] },
    courseGroupMap: { listMappings: async () => ({}) },
    logger: silentLogger,
  }).run();

  assert.equal(r.unmapped[0].suggestion, null);
});

test("mapear valida que sea un JID de grupo", async () => {
  const guardados = [];
  const deps = {
    courseGroupMap: { setChatForCourse: async (c, j) => void guardados.push([c, j]) },
    chatDirectory: { listChats: async () => [{ jid: "g@g.us", name: "Grupo", isGroup: true }] },
    logger: silentLogger,
  };

  const malo = await new MapCourseGroup(deps).run(2279, "51999@s.whatsapp.net");
  assert.equal(malo.mapped, false);
  assert.equal(guardados.length, 0, "no se guarda un chat individual");

  const bueno = await new MapCourseGroup(deps).run(2279, "g@g.us");
  assert.equal(bueno.mapped, true);
  assert.equal(bueno.groupName, "Grupo");
  assert.deepEqual(guardados, [[2279, "g@g.us"]]);
});

test("mapear avisa si el JID no aparece entre tus chats, pero igual lo guarda", async () => {
  const r = await new MapCourseGroup({
    courseGroupMap: { setChatForCourse: async () => {} },
    chatDirectory: { listChats: async () => [] },
    logger: silentLogger,
  }).run(2279, "desconocido@g.us");

  assert.equal(r.mapped, true);
  assert.match(r.warning, /no aparece/);
});

// ---------------------------------------------------------- reconciliación

test("encuentra lo que el bridge dejó huérfano en la agenda", async () => {
  const agenda = {
    listOwnItems: async () => ({
      tasks: [
        { id: 1, title: "[DUTIC] CURSO A: Tarea viva" },
        { id: 2, title: "[DUTIC] CURSO B: Tarea perdida" },
        { id: 3, title: "Comprar pan" },
      ],
      events: [{ id: 90, title: "⚠️ Conflicto de fecha: CURSO C" }],
    }),
    close: async () => {},
  };
  const state = { tasks: { 1: { waconTaskId: 1, waconEventId: 50 } } };

  const r = await new ReconcileAgenda({ agenda, stateRepository: { load: async () => state }, logger: silentLogger }).run();

  assert.deepEqual(r.orphanTasks.map((t) => t.id), [2], "la 3 no es del bridge y la 1 está trackeada");
  assert.deepEqual(r.orphanEvents.map((e) => e.id), [90]);
  assert.equal(r.closed, false, "por defecto sólo reporta");
});

test("con close cierra los huérfanos", async () => {
  const cerrados = [];
  const agenda = {
    listOwnItems: async () => ({ tasks: [{ id: 2, title: "[DUTIC] X" }], events: [] }),
    close: async (x) => void cerrados.push(x),
  };
  const r = await new ReconcileAgenda({ agenda, stateRepository: { load: async () => ({ tasks: {} }) }, logger: silentLogger }).run({ close: true });

  assert.equal(r.closed, true);
  assert.deepEqual(cerrados, [{ taskId: 2 }]);
});

// ---------------------------------------------------------- búsqueda

test("busca sólo dentro del grupo del curso", async () => {
  /** @type {any} */
  let usado = null;
  const r = await new SearchCourseChat({
    courseGroupMap: { getChatForCourse: async () => "curso@g.us" },
    messageSearch: {
      search: async (input) => {
        usado = input;
        return [{ id: "1", text: "el formato es APA", snippet: "el *formato* es APA", timestamp: Date.now(), fromMe: false }];
      },
    },
    logger: silentLogger,
  }).run(2263, "formato");

  assert.equal(usado.chatJid, "curso@g.us", "acotada al grupo, no busca en todo WhatsApp");
  assert.equal(r.hits.length, 1);
});

test("sin grupo mapeado, la búsqueda explica qué falta", async () => {
  const r = await new SearchCourseChat({
    courseGroupMap: { getChatForCourse: async () => null },
    messageSearch: { search: async () => [] },
    logger: silentLogger,
  }).run(2287, "algo");

  assert.equal(r.searched, false);
  assert.match(r.message, /grupos/);
});
