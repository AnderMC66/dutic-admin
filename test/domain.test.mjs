/**
 * Los servicios de dominio que decidian cosas importantes sin una sola prueba:
 * si te avisa que estás en riesgo, qué estudiás primero, a qué hora sale el
 * brief y quién de tu grupo es realmente compañero de curso.
 *
 * Todos son puros y determinísticos — se les pasa el `now` en vez de dejarlos
 * mirar el reloj, para que no dependan de a qué hora se corre la suite.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = pathToFileURL(join(import.meta.dirname, "..", "src")).href;
const { assessCourseRisk, parseGradeNumber } = await import(`${SRC}/domain/services/GradeRisk.mjs`);
const { rankByStudyPriority } = await import(`${SRC}/domain/services/StudyPriority.mjs`);
const { isDailyBriefDue, limaDateStr } = await import(`${SRC}/domain/services/DailyScheduleClock.mjs`);
const { namesMatch, matchRosterToGroup } = await import(`${SRC}/domain/services/NameMatcher.mjs`);
const { findDateConflicts, describeConflict } = await import(`${SRC}/domain/services/ConflictDetector.mjs`);
const { findSilentOverdue } = await import(`${SRC}/domain/services/OverdueAnalyzer.mjs`);
const { isPending, isStateUnknown, isExamTask, isDueWithin } = await import(`${SRC}/domain/entities/AcademicTask.mjs`);
const { parseCommand } = await import(`${SRC}/domain/entities/Command.mjs`);
const { isBridgeReminder, buildReminderText } = await import(`${SRC}/domain/entities/Reminder.mjs`);

// ---------------------------------------------------------------- GradeRisk

const curso = (totalPercentage) => ({ courseId: 1, courseName: "MICROECONOMÍA I", total: null, totalPercentage });

test("parseGradeNumber entiende el formato de Moodle en español", () => {
  assert.equal(parseGradeNumber("16,00"), 16);
  assert.equal(parseGradeNumber("45,50 %"), 45.5);
  assert.equal(parseGradeNumber("70"), 70);
  assert.equal(parseGradeNumber(null), null);
  assert.equal(parseGradeNumber("-"), null);
  assert.equal(parseGradeNumber(""), null);
});

test("clasifica el riesgo alrededor del mínimo aprobatorio (52,5% = 10,5/20)", () => {
  assert.equal(assessCourseRisk(curso("40,00")).status, "riesgo");
  assert.equal(assessCourseRisk(curso("52,00")).status, "riesgo");
  assert.equal(assessCourseRisk(curso("52,50")).status, "atencion", "justo en el mínimo todavía es para vigilar");
  assert.equal(assessCourseRisk(curso("60,00")).status, "atencion");
  assert.equal(assessCourseRisk(curso("62,50")).status, "ok");
  assert.equal(assessCourseRisk(curso("95,00")).status, "ok");
  assert.equal(assessCourseRisk(curso(null)).status, "sin_datos");
});

test("el mínimo aprobatorio es configurable", () => {
  assert.equal(assessCourseRisk(curso("60,00"), null, { passingPercentage: 70 }).status, "riesgo");
  assert.equal(assessCourseRisk(curso("60,00"), null, { passingPercentage: 40 }).status, "ok");
});

test("SISACAD manda sobre el cálculo de Moodle porque es la fuente oficial", () => {
  const r = assessCourseRisk(curso("90,00"), { weightedAverageSoFar: 8 });
  assert.equal(r.sisacadPercentage, 40);
  assert.equal(r.referencePercentage, 40, "se usa SISACAD, no el 90% de Moodle");
  assert.equal(r.status, "riesgo");
  assert.equal(r.referenceOn20, 8, "el equivalente 0-20 vuelve a dar la nota de SISACAD");
});

test("marca la discrepancia SISACAD vs Moodle solo cuando es grande", () => {
  assert.equal(assessCourseRisk(curso("50,00"), { weightedAverageSoFar: 11 }).discrepancy, null, "5 puntos: dentro de lo esperable");
  const r = assessCourseRisk(curso("50,00"), { weightedAverageSoFar: 14 }); // 70%
  assert.deepEqual(r.discrepancy, { moodlePercentage: 50, sisacadPercentage: 70, diff: 20 });
});

test("sin nota de SISACAD se cae a Moodle sin inventar discrepancias", () => {
  const r = assessCourseRisk(curso("80,00"), { weightedAverageSoFar: null });
  assert.equal(r.referencePercentage, 80);
  assert.equal(r.discrepancy, null);
});

// ---------------------------------------------------------------- StudyPriority

const AHORA = Date.UTC(2026, 6, 1, 12, 0, 0);
const enDias = (d) => Math.floor((AHORA + d * 86_400_000) / 1000);

test("prioriza por lo que cuesta NO estudiar, no sólo por fecha", () => {
  const tasks = [
    { cmid: 1, courseId: 10, name: "Examen parcial", dueDate: enDias(10) }, // lejos pero pesado
    { cmid: 2, courseId: 10, name: "Foro semanal", dueDate: enDias(2) }, // cerca pero liviano
  ];
  const items = new Map([[10, [{ name: "Examen parcial", weight: "40,00 %" }, { name: "Foro semanal", weight: "2,00 %" }]]]);

  const ranked = rankByStudyPriority(tasks, items, AHORA);
  assert.equal(ranked[0].task.name, "Examen parcial");
  assert.equal(ranked[0].weightPercent, 40);
  assert.equal(ranked[1].weightPercent, 2);
});

test("con el mismo peso, gana lo que vence antes", () => {
  const tasks = [
    { cmid: 1, courseId: 10, name: "Trabajo A", dueDate: enDias(8) },
    { cmid: 2, courseId: 10, name: "Trabajo B", dueDate: enDias(1) },
  ];
  const items = new Map([[10, [{ name: "Trabajo A", weight: "20,00 %" }, { name: "Trabajo B", weight: "20,00 %" }]]]);
  assert.equal(rankByStudyPriority(tasks, items, AHORA)[0].task.name, "Trabajo B");
});

test("una tarea sin ítem identificable pesa el default, no cero (no desaparece del orden)", () => {
  const ranked = rankByStudyPriority([{ cmid: 1, courseId: 10, name: "Algo suelto", dueDate: enDias(1) }], new Map(), AHORA);
  assert.equal(ranked[0].weightPercent, null, "no se pudo identificar el peso real");
  assert.ok(ranked[0].priorityScore > 0, "pero igual entra en el ranking");
});

test("una tarea vencida no divide por cero", () => {
  const ranked = rankByStudyPriority([{ cmid: 1, courseId: 10, name: "Vencida", dueDate: enDias(-5) }], new Map(), AHORA);
  assert.ok(Number.isFinite(ranked[0].priorityScore));
  assert.ok(ranked[0].daysLeft > 0, "se acota a un mínimo en vez de quedar negativo");
});

test("una tarea sin fecha no rompe el ranking", () => {
  const ranked = rankByStudyPriority([{ cmid: 1, courseId: 10, name: "Sin fecha", dueDate: null }], new Map(), AHORA);
  assert.equal(ranked[0].priorityScore, 0);
  assert.equal(ranked[0].daysLeft, null);
});

test("el total del curso no se confunde con una tarea", () => {
  const items = new Map([[10, [{ name: "Trabajo", weight: "30,00 %", isTotal: true }]]]);
  const ranked = rankByStudyPriority([{ cmid: 1, courseId: 10, name: "Trabajo", dueDate: enDias(1) }], items, AHORA);
  assert.equal(ranked[0].weightPercent, null, "el ítem 'total' se ignora");
});

// ---------------------------------------------------------------- DailyScheduleClock

// Perú es UTC-5 todo el año: 03:00 UTC del 30 son las 22:00 del 29 en Lima.
const UTC_30_A_LAS_3 = Date.UTC(2026, 6, 30, 3, 0, 0);
const UTC_30_A_LAS_13 = Date.UTC(2026, 6, 30, 13, 0, 0);

test("la fecha de Lima no es la UTC de madrugada", () => {
  assert.equal(limaDateStr(UTC_30_A_LAS_3), "2026-07-29", "todavía es el día anterior en Lima");
  assert.equal(limaDateStr(UTC_30_A_LAS_13), "2026-07-30");
});

test("el brief sale una vez, pasada la hora configurada", () => {
  // 13:00 UTC = 08:00 en Lima
  assert.equal(isDailyBriefDue(7, "2026-07-29", UTC_30_A_LAS_13), true, "ya pasaron las 7 y hoy no se mandó");
  assert.equal(isDailyBriefDue(7, "2026-07-30", UTC_30_A_LAS_13), false, "hoy ya se mandó");
  assert.equal(isDailyBriefDue(9, "2026-07-29", UTC_30_A_LAS_13), false, "todavía no son las 9");
  assert.equal(isDailyBriefDue(0, "2026-07-29", UTC_30_A_LAS_13), true, "a las 0 siempre está vencido");
});

test("sin registro previo, se manda", () => {
  assert.equal(isDailyBriefDue(7, undefined, UTC_30_A_LAS_13), true);
});

// ---------------------------------------------------------------- NameMatcher

test("empareja el nombre oficial completo con el apodo de WhatsApp", () => {
  assert.equal(namesMatch("RODRIGO ANDERSON CAPIA CONDORI", "Rodrigo Capia"), true);
  assert.equal(namesMatch("MARÍA JOSÉ QUISPE MAMANI", "Maria Quispe"), true, "con y sin tildes");
  assert.equal(namesMatch("RODRIGO ANDERSON CAPIA CONDORI", "Rodrigo Vargas Peña"), false, "un solo nombre en común no alcanza");
  assert.equal(namesMatch("JUAN PEREZ", "Juan"), true, "si el otro lado es un solo token, alcanza con uno");
  assert.equal(namesMatch("", "Juan"), false);
  assert.equal(namesMatch(null, null), false);
});

test("el cruce roster/grupo no usa a la misma persona dos veces", () => {
  const roster = [{ name: "ANA MARIA TORRES LOPEZ" }, { name: "ANA LUCIA TORRES RAMOS" }];
  const group = [{ name: "Ana Torres" }];
  const { matched, onlyInRoster, onlyInGroup } = matchRosterToGroup(roster, group);

  assert.equal(matched.length, 1, "el único miembro del grupo se consume con el primer match");
  assert.equal(onlyInRoster.length, 1);
  assert.equal(onlyInGroup.length, 0);
});

test("el cruce reporta los tres grupos", () => {
  const roster = [{ name: "JUAN PEREZ GOMEZ" }, { name: "LUIS SOTO DIAZ" }];
  const group = [{ name: "Juan Perez" }, { name: "Mamá" }];
  const r = matchRosterToGroup(roster, group);

  assert.deepEqual(r.matched.map((m) => m.roster.name), ["JUAN PEREZ GOMEZ"]);
  assert.deepEqual(r.onlyInRoster.map((p) => p.name), ["LUIS SOTO DIAZ"]);
  assert.deepEqual(r.onlyInGroup.map((p) => p.name), ["Mamá"]);
});

// ---------------------------------------------------------------- ConflictDetector

const TAREA_MOODLE = {
  cmid: 7,
  courseId: 10,
  courseName: "ESTADÍSTICA PARA ECONOMISTAS III",
  name: "Práctica 4",
  submission: "not-submitted",
  dueDate: Math.floor(Date.UTC(2026, 6, 10, 5, 0, 0) / 1000),
};

test("detecta que el grupo dice una fecha y Moodle otra", () => {
  const sugeridos = [
    { id: "s1", chatName: "Estadística III", title: "Entrega práctica", raw: "la práctica se entrega el viernes", when: "2026-07-13T05:00:00.000Z" },
  ];
  const conflictos = findDateConflicts([TAREA_MOODLE], sugeridos, [], 20);
  assert.equal(conflictos.length, 1);
  assert.equal(conflictos[0].key, "7:s1");
  assert.ok(conflictos[0].diffHours > 20);

  const descripcion = describeConflict(conflictos[0]);
  assert.match(descripcion.title, /Conflicto de fecha/);
  assert.match(descripcion.notes, /Práctica 4/);
});

test("una diferencia chica no es un conflicto", () => {
  const sugeridos = [{ id: "s1", chatName: "Estadística III", raw: "es mañana", when: "2026-07-10T12:00:00.000Z" }];
  assert.equal(findDateConflicts([TAREA_MOODLE], sugeridos, [], 20).length, 0);
});

test("no se vuelve a marcar un conflicto ya avisado", () => {
  const sugeridos = [{ id: "s1", chatName: "Estadística III", raw: "el viernes", when: "2026-07-13T05:00:00.000Z" }];
  assert.equal(findDateConflicts([TAREA_MOODLE], sugeridos, ["7:s1"], 20).length, 0);
});

test("un evento de otro curso no genera conflicto", () => {
  const sugeridos = [{ id: "s1", chatName: "Derecho Empresarial", raw: "el viernes", when: "2026-07-13T05:00:00.000Z" }];
  assert.equal(findDateConflicts([TAREA_MOODLE], sugeridos, [], 20).length, 0);
});

test("una tarea sin cmid no genera conflictos (su clave sería ambigua)", () => {
  const sinCmid = { ...TAREA_MOODLE, cmid: null };
  const sugeridos = [{ id: "s1", chatName: "Estadística III", raw: "el viernes", when: "2026-07-13T05:00:00.000Z" }];
  assert.equal(findDateConflicts([sinCmid], sugeridos, [], 20).length, 0);
});

// ---------------------------------------------------------------- OverdueAnalyzer

test("separa las vencidas en silencio de las que el grupo ya explicó", () => {
  const vencida = { ...TAREA_MOODLE, dueDate: Math.floor(Date.UTC(2026, 5, 1) / 1000) };
  const ahora = Date.UTC(2026, 6, 1);

  const sinAviso = findSilentOverdue([vencida], [], ahora);
  assert.equal(sinAviso[0].silent, true);

  const conProrroga = findSilentOverdue(
    [vencida],
    [{ id: "s1", chatName: "Estadística III", raw: "el profe dijo que se extiende hasta el lunes" }],
    ahora,
  );
  assert.equal(conProrroga[0].silent, false, "alguien mencionó una prórroga");
});

test("una tarea que todavía no vence no aparece como vencida", () => {
  assert.equal(findSilentOverdue([TAREA_MOODLE], [], Date.UTC(2026, 5, 1)).length, 0);
});

// ---------------------------------------------------------------- entidades

test("isPending y isStateUnknown distinguen los tres casos", () => {
  assert.equal(isPending({ submission: "not-submitted", cmid: 1 }), true);
  assert.equal(isPending({ submission: "submitted", cmid: 1 }), false);
  assert.equal(isPending({ submission: "unknown", cmid: 1 }), false);
  assert.equal(isPending({ submission: "not-submitted", cmid: null }), false);

  // El caso que antes desaparecía sin dejar rastro.
  assert.equal(isStateUnknown({ submission: "unknown", cmid: 1 }), true);
  assert.equal(isStateUnknown({ submission: "not-submitted", cmid: 1 }), false);
  assert.equal(isStateUnknown({ submission: "unknown", cmid: null }), false);
});

test("reconoce las tareas tipo examen", () => {
  assert.equal(isExamTask({ name: "Examen parcial" }), true);
  assert.equal(isExamTask({ name: "EVALUACIÓN CONTINUA" }), true);
  assert.equal(isExamTask({ name: "Foro de la semana 3" }), false);
});

test("isDueWithin mira sólo hacia adelante", () => {
  const ahora = Date.UTC(2026, 6, 1);
  assert.equal(isDueWithin({ dueDate: enDias(2) }, 3, AHORA), true);
  assert.equal(isDueWithin({ dueDate: enDias(5) }, 3, AHORA), false);
  assert.equal(isDueWithin({ dueDate: enDias(-1) }, 3, AHORA), false, "ya venció");
  assert.equal(isDueWithin({ dueDate: null }, 3, ahora), false);
});

test("parseCommand entiende el prefijo y los argumentos", () => {
  assert.deepEqual(parseCommand("!brief"), { name: "brief", args: [] });
  assert.deepEqual(parseCommand("  !Estudio 2263 integrales dobles  "), { name: "estudio", args: ["2263", "integrales", "dobles"] });
  assert.equal(parseCommand("brief"), null, "sin prefijo no es comando");
  assert.equal(parseCommand("📚 *Consejo de estudio*"), null, "los avisos del propio bridge nunca son comandos");
  assert.equal(parseCommand("!"), null);
  assert.equal(parseCommand(null), null);
});

test("sólo se reconocen como recordatorios propios los que el bridge creó", () => {
  assert.equal(isBridgeReminder({ title: "[DUTIC] CURSO: Tarea" }), true);
  assert.equal(isBridgeReminder({ title: "⚠️ Conflicto de fecha: CURSO" }), true);
  assert.equal(isBridgeReminder({ title: "Cumpleaños de mamá" }), false, "eventos de otros clientes de wacon");
  assert.equal(isBridgeReminder({}), false);

  const texto = buildReminderText({ title: "[DUTIC] X", minutesUntilStart: 120, notes: "detalle" });
  assert.match(texto, /Recordatorio/);
  assert.match(texto, /~2h/);
});
