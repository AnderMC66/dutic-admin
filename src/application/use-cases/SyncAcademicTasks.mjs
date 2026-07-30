import { join } from "node:path";
import { isPending, isStateUnknown, taskTitle, dueDateIso } from "../../domain/entities/AcademicTask.mjs";
import { findDateConflicts, describeConflict } from "../../domain/services/ConflictDetector.mjs";
import { findSilentOverdue } from "../../domain/services/OverdueAnalyzer.mjs";
import { safeFileName } from "../../domain/services/SafeFileName.mjs";

const MAX_DESCRIPTION_CHARS = 1200;

const DEFAULT_REMINDER_MINUTES_BEFORE = 24 * 60;
const DEFAULT_CONFLICT_THRESHOLD_HOURS = 20;
const DEFAULT_FAILURE_NOTIFY_COOLDOWN_MS = 24 * 60 * 60_000;

/** Identifica "el mismo fallo" entre corridas: el mensaje, normalizado y acotado. */
function failureSignature(err) {
  return String(err?.message ?? err)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Sincroniza las tareas pendientes de una fuente académica (AcademicTaskSourcePort)
 * hacia una agenda (AgendaPort), y avisa por un canal (NotifierPort) cuando hay
 * novedades. Solo conoce contratos — nunca a dutic-mcp ni a wacon-mcp directamente,
 * así que se puede probar con dobles de prueba y reusar con otras fuentes/canales.
 */
export class SyncAcademicTasks {
  constructor({
    taskSource,
    agenda,
    notifier,
    stateRepository,
    logger,
    attachments,
    attachmentsDestDir,
    runLock,
    reminderMinutesBefore = DEFAULT_REMINDER_MINUTES_BEFORE,
    conflictThresholdHours = DEFAULT_CONFLICT_THRESHOLD_HOURS,
    failureNotifyCooldownMs = DEFAULT_FAILURE_NOTIFY_COOLDOWN_MS,
  }) {
    this.taskSource = taskSource;
    this.agenda = agenda;
    this.notifier = notifier;
    this.stateRepository = stateRepository;
    this.logger = logger;
    this.runLock = runLock;
    this.attachments = attachments;
    this.attachmentsDestDir = attachmentsDestDir;
    this.reminderMinutesBefore = reminderMinutesBefore;
    this.conflictThresholdHours = conflictThresholdHours;
    this.failureNotifyCooldownMs = failureNotifyCooldownMs;
  }

  /**
   * Dos sincronizaciones a la vez (el cron de 6h disparando mientras escribís
   * "!sync" por WhatsApp) se pisan el estado de `tasks`: la segunda en guardar
   * deja huérfanas en la agenda las tareas que creó la primera, y la corrida
   * siguiente las re-crea y te las re-anuncia. Se serializan entre procesos.
   */
  async run() {
    if (!this.runLock) return this.performSync();
    return this.runLock.withExclusiveRun("sync-academic-tasks", () => this.performSync());
  }

  async performSync() {
    let tasks, scanErrors;
    try {
      ({ tasks, scanErrors } = await this.taskSource.listAllTasks());
    } catch (err) {
      this.logger.log(`ERROR obteniendo tareas: ${err.message}`);
      await this.reportFailure(err);
      throw err;
    }
    await this.reportRecovery();

    if (scanErrors?.length) {
      this.logger.log(`${scanErrors.length} curso(s) no se pudieron barrer: ${scanErrors.map((e) => e.courseName).join(", ")}`);
    }
    const unscanned = unscannedCourseKeys(scanErrors);

    const state = await this.stateRepository.load();
    const prevTasks = state.tasks;
    const byCmid = new Map(tasks.filter((t) => t.cmid != null).map((t) => [String(t.cmid), t]));
    const newTasksState = {};
    const added = [];
    const dueChanged = [];
    const resolved = [];
    const keptUnscanned = [];

    // Lo que ya estaba trackeado y dejó de estar pendiente (entregado, calificado
    // o desapareció): se cierra su reflejo en la agenda.
    for (const [cmid, prevEntry] of Object.entries(prevTasks)) {
      const current = byCmid.get(cmid);
      if (current && isPending(current)) continue;

      // Si el curso de esta tarea no se pudo barrer, su ausencia del resultado
      // no significa nada: ausencia != entregada. Cerrarla acá la sacaría de la
      // agenda y la corrida siguiente la traería de vuelta como "nueva", con
      // WhatsApp y adjuntos incluidos. Se preserva el tracking tal cual.
      if (!current && isUnscanned(prevEntry, unscanned)) {
        newTasksState[cmid] = prevEntry;
        keptUnscanned.push(prevEntry.title);
        continue;
      }

      await this.agenda
        .close({ taskId: prevEntry.waconTaskId, eventId: prevEntry.waconEventId })
        .catch((e) => this.logger.log(`close falló para ${cmid}: ${e.message}`));
      resolved.push(prevEntry.title);
    }

    if (keptUnscanned.length) {
      this.logger.log(`${keptUnscanned.length} tarea(s) de cursos no barridos se mantienen sin cambios (no se cierran ni se re-anuncian).`);
    }

    // Lo pendiente hoy: crear lo nuevo, reprogramar lo que cambió de fecha.
    for (const task of tasks) {
      if (!isPending(task)) continue;
      const cmid = String(task.cmid);
      const title = taskTitle(task);
      const dueIso = dueDateIso(task);
      const prevEntry = prevTasks[cmid];

      if (!prevEntry) {
        const { taskId, eventId } = await this.agenda.upsertPendingTask({
          title,
          dueDateIso: dueIso,
          notes: buildAgendaNotes(task),
          notifyBeforeMinutes: this.reminderMinutesBefore,
        });
        newTasksState[cmid] = {
          title,
          courseName: task.courseName,
          // Se guarda para poder reconocer, en corridas futuras, si el curso de
          // esta tarea es uno que no se pudo barrer (ver unscannedCourseKeys).
          courseId: task.courseId,
          dueDate: task.dueDate,
          submission: task.submission,
          dateConflict: task.dateConflict,
          waconTaskId: taskId,
          waconEventId: eventId,
        };
        added.push(task);

        // Cada tarea nueva se avisa de una: indicaciones completas + adjuntos,
        // en vez de una línea suelta en el resumen agregado del final.
        const filePaths = await this.downloadAttachments(task);
        await this.notifier
          .notify(buildNewTaskMessage(task), filePaths)
          .catch((e) => this.logger.log(`notify (tarea nueva) falló para ${cmid}: ${e.message}`));
        continue;
      }

      newTasksState[cmid] = { ...prevEntry, title, courseId: task.courseId, submission: task.submission, dateConflict: task.dateConflict };

      if (task.dueDate !== prevEntry.dueDate) {
        const { taskId: rescheduledTaskId, eventId } = await this.agenda
          .reschedule({
            taskId: prevEntry.waconTaskId,
            eventId: prevEntry.waconEventId,
            title,
            dueDateIso: dueIso,
            notes: "Fecha actualizada por la fuente académica.",
            notifyBeforeMinutes: this.reminderMinutesBefore,
          })
          .catch((e) => {
            this.logger.log(`reschedule falló para ${cmid}: ${e.message}`);
            return {};
          });
        newTasksState[cmid].waconEventId = eventId;
        // La agenda puede haber reemplazado la tarea por una nueva en vez de
        // actualizarla: si devolvió otro id, es el que hay que seguir usando.
        if (rescheduledTaskId != null) newTasksState[cmid].waconTaskId = rescheduledTaskId;
        newTasksState[cmid].dueDate = task.dueDate;
        dueChanged.push({ task, from: prevEntry.dueDate });
      }
    }

    // Cruce: lo oficial vs. lo que ya se extrajo de otra fuente (grupos de curso).
    const suggested = await this.agenda.listSuggestedEvents().catch((e) => {
      this.logger.log(`listSuggestedEvents falló: ${e.message}`);
      return [];
    });
    const conflicts = findDateConflicts(tasks, suggested, state.flaggedConflicts, this.conflictThresholdHours);
    for (const c of conflicts) {
      await this.agenda.flagConflict(describeConflict(c)).catch((e) => this.logger.log(`flagConflict falló: ${e.message}`));
      state.flaggedConflicts.push(c.key);
    }

    // La señal más urgente: tareas ya vencidas y sin entregar donde nadie
    // mencionó una prórroga en el grupo del curso.
    const silentOverdue = findSilentOverdue(tasks, suggested)
      .filter((o) => o.silent)
      .filter((o) => !state.silentOverdueFlagged.includes(String(o.task.cmid)));
    for (const o of silentOverdue) state.silentOverdueFlagged.push(String(o.task.cmid));

    // Tareas cuyo estado de entrega no se pudo leer: no se tocan (no sabemos si
    // están entregadas), pero se cuentan y se avisan, porque el resto del
    // sistema las descarta en silencio y son indistinguibles de una entregada.
    // Sólo se avisan las nuevas: una tarea que falla el enriquecimiento corrida
    // tras corrida no puede mandarte el mismo WhatsApp cada 6 horas.
    const unknownState = tasks.filter(isStateUnknown);
    const alreadyFlagged = new Set(state.unknownStateFlagged ?? []);
    const newUnknownState = unknownState.filter((t) => !alreadyFlagged.has(String(t.cmid)));
    const currentUnknownCmids = unknownState.map((t) => String(t.cmid));
    // Con datos completos la marca es exactamente el conjunto actual, así que una
    // tarea que vuelve a leerse bien se destildia sola y podría volver a avisar
    // si falla de nuevo. Con datos parciales sólo se agrega, nunca se saca.
    state.unknownStateFlagged = scanErrors?.length ? [...new Set([...alreadyFlagged, ...currentUnknownCmids])] : currentUnknownCmids;

    state.tasks = newTasksState;
    pruneStaleFlags(state, byCmid, scanErrors, this.logger);
    await this.stateRepository.save(state);

    const summary = { added, dueChanged, resolved, conflicts, silentOverdue, keptUnscanned, unknownState, newUnknownState, scanErrors: scanErrors ?? [] };
    this.logger.log(
      `Resumen: +${added.length} nuevas, ${dueChanged.length} con fecha cambiada, ${resolved.length} resueltas, ` +
        `${conflicts.length} conflictos, ${silentOverdue.length} vencidas sin aviso, ${unknownState.length} sin estado legible.`,
    );

    // Las tareas nuevas ya se avisaron una por una (con indicaciones y adjuntos) dentro del
    // loop de arriba; este resumen agregado es solo para el resto de categorías.
    if (dueChanged.length || resolved.length || conflicts.length || silentOverdue.length || newUnknownState.length) {
      await this.notifier.notify(buildSummaryMessage(summary)).catch((e) => this.logger.log(`notify falló: ${e.message}`));
    }

    return summary;
  }

  /**
   * Avisa que el sync falló, pero una sola vez por causa y con un techo diario.
   *
   * Antes avisaba en cada corrida: con el cron cada 6 h y una sesión de Moodle
   * caducada —que sólo se arregla corriendo `dutic login` a mano— eso es el
   * mismo WhatsApp indefinidamente. El costo no es el ruido: es que te
   * acostumbra a ignorar los avisos del bridge, justo lo que no querés cuando
   * el próximo diga "tenés una entrega mañana".
   */
  async reportFailure(err) {
    const state = await this.stateRepository.load();
    const signature = failureSignature(err);
    const previous = state.syncFailure;
    const repeated = previous?.signature === signature;
    const withinCooldown = repeated && Date.now() - (previous?.notifiedAt ?? 0) < this.failureNotifyCooldownMs;

    state.syncFailure = {
      signature,
      message: err.message,
      firstFailedAt: repeated ? (previous.firstFailedAt ?? Date.now()) : Date.now(),
      failureCount: repeated ? (previous.failureCount ?? 0) + 1 : 1,
      notifiedAt: withinCooldown ? previous.notifiedAt : Date.now(),
    };
    await this.stateRepository.save(state);

    if (withinCooldown) {
      this.logger.log(`Mismo fallo que la corrida anterior (${state.syncFailure.failureCount} seguidas); no se repite el aviso.`);
      return;
    }

    const desde = repeated ? `\nFalla desde ${new Date(state.syncFailure.firstFailedAt).toLocaleString("es-PE")} (${state.syncFailure.failureCount} intentos).` : "";
    await this.notifier
      .notify(`⚠️ No se pudo sincronizar tu fuente académica.\nError: ${err.message}${desde}`)
      .catch((e) => this.logger.log(`no se pudo avisar del error: ${e.message}`));
  }

  /** Si veníamos fallando y ya no, decilo: si no, nunca sabés que volvió a andar. */
  async reportRecovery() {
    const state = await this.stateRepository.load();
    if (!state.syncFailure) return;

    const { failureCount, firstFailedAt } = state.syncFailure;
    delete state.syncFailure;
    await this.stateRepository.save(state);

    this.logger.log(`Sincronización recuperada tras ${failureCount} intento(s) fallido(s).`);
    await this.notifier
      .notify(`✅ La sincronización con DUTIC volvió a funcionar (fallaba desde ${new Date(firstFailedAt).toLocaleString("es-PE")}).`)
      .catch((e) => this.logger.log(`no se pudo avisar la recuperación: ${e.message}`));
  }

  /** Descarga los adjuntos de una tarea (guías, rúbricas) a disco; nunca revienta el sync si falla. */
  async downloadAttachments(task) {
    if (!this.attachments || !this.attachmentsDestDir || !task.attachments?.length) return [];
    const paths = [];
    for (const a of task.attachments) {
      // El nombre lo eligió Moodle, no nosotros: se sanea antes de convertirlo
      // en un path (ver safeFileName).
      const dest = join(this.attachmentsDestDir, String(task.cmid), safeFileName(a.filename));
      const result = await this.attachments.downloadAttachment({ url: a.url, dest }).catch((e) => {
        this.logger.log(`downloadAttachment falló para "${a.filename}": ${e.message}`);
        return null;
      });
      if (result?.path) paths.push(result.path);
    }
    return paths;
  }
}

/**
 * Claves (courseId y courseName) de los cursos que la fuente académica no pudo
 * barrer en esta corrida. Se aceptan las dos porque el estado viejo, escrito
 * antes de que se guardara courseId, solo tiene el nombre.
 */
function unscannedCourseKeys(scanErrors) {
  const keys = new Set();
  for (const e of scanErrors ?? []) {
    if (e?.courseId != null) keys.add(String(e.courseId));
    if (e?.courseName) keys.add(String(e.courseName));
  }
  return keys;
}

/**
 * Las marcas de "esto ya te lo avisé" (conflictos de fecha, vencidas en
 * silencio) se acumulaban para siempre: son listas a las que solo se hacía push.
 * Una vez que la tarea desapareció de la fuente, su marca no sirve más.
 *
 * No se poda nada si algún curso no se pudo barrer: en ese caso la ausencia de
 * una tarea no significa que ya no exista, y borrar su marca haría que el
 * próximo sync te volviera a avisar del mismo conflicto.
 */
function pruneStaleFlags(state, byCmid, scanErrors, logger) {
  if (scanErrors?.length) return;

  const before = state.flaggedConflicts.length + state.silentOverdueFlagged.length;
  // Las claves de conflicto son "cmid:idDelEventoSugerido".
  state.flaggedConflicts = state.flaggedConflicts.filter((key) => byCmid.has(String(key).split(":")[0]));
  state.silentOverdueFlagged = state.silentOverdueFlagged.filter((cmid) => byCmid.has(String(cmid)));

  const removed = before - (state.flaggedConflicts.length + state.silentOverdueFlagged.length);
  if (removed > 0) logger.log(`Estado: ${removed} marca(s) de tareas que ya no existen, descartadas.`);
}

function isUnscanned(prevEntry, unscanned) {
  if (!unscanned.size) return false;
  return (prevEntry.courseId != null && unscanned.has(String(prevEntry.courseId))) || unscanned.has(String(prevEntry.courseName));
}

function truncate(text, max, moreHint) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max)}…${moreHint ? ` (${moreHint})` : ""}`;
}

/** Notas que quedan guardadas en la tarea de wacon — cortas, para que `wacon tasks` no se sature. */
function buildAgendaNotes(task) {
  const parts = [];
  if (task.description) parts.push(truncate(task.description, 300, `detalle completo: dutic task ${task.cmid}`));
  if (task.url) parts.push(task.url);
  return parts.length ? parts.join("\n") : undefined;
}

/** Mensaje individual de WhatsApp para cada tarea nueva: indicaciones completas + de dónde salió. */
function buildNewTaskMessage(task) {
  const when = task.dueDate ? new Date(task.dueDate * 1000).toLocaleString("es-PE") : "sin fecha";
  const lines = [`🆕 *${task.courseName}*`, task.name, `📅 Entrega: ${when}`];
  if (task.hidden) lines.push("👁️ Tarea OCULTA — no aparece en el calendario de Moodle.");
  if (task.dateConflict) lines.push("⚠️ La consigna menciona una fecha distinta a la configurada — revisa el detalle.");
  if (task.description) {
    lines.push("\n📝 *Indicaciones:*");
    lines.push(truncate(task.description, MAX_DESCRIPTION_CHARS, `detalle completo: dutic task ${task.cmid}`));
  }
  if (task.attachments?.length) {
    lines.push(`\n📎 Adjunto${task.attachments.length > 1 ? "s" : ""}: ${task.attachments.map((a) => a.filename).join(", ")}`);
  }
  if (task.url) lines.push(`\n${task.url}`);
  return lines.join("\n");
}

function buildSummaryMessage({ dueChanged, resolved, conflicts, silentOverdue, newUnknownState }) {
  const lines = ["📚 *DUTIC ↔ wacon* — novedades:"];
  if (dueChanged.length) {
    lines.push(`\n📅 Fecha cambiada (${dueChanged.length}):`);
    for (const { task } of dueChanged) lines.push(`• ${task.courseName}: ${task.name} → ${new Date(task.dueDate * 1000).toLocaleDateString("es-PE")}`);
  }
  if (resolved.length) {
    lines.push(`\n✅ Resueltas (${resolved.length}):`);
    for (const t of resolved) lines.push(`• ${t}`);
  }
  if (conflicts.length) {
    lines.push(`\n⚠️ Conflictos de fecha (${conflicts.length}) — revisa 'wacon tasks':`);
    for (const c of conflicts) lines.push(`• ${c.task.courseName}: ${c.task.name}`);
  }
  if (silentOverdue?.length) {
    lines.push(`\n🚨 Vencidas SIN aviso de prórroga (${silentOverdue.length}):`);
    for (const o of silentOverdue) lines.push(`• ${o.task.courseName}: ${o.task.name}`);
  }
  if (newUnknownState?.length) {
    lines.push(`\n❔ No se pudo leer si están entregadas (${newUnknownState.length}) — revisalas en Moodle:`);
    for (const t of newUnknownState) lines.push(`• ${t.courseName}: ${t.name}`);
  }
  return lines.join("\n");
}
