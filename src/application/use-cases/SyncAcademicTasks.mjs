import { join } from "node:path";
import { isPending, taskTitle, dueDateIso } from "../../domain/entities/AcademicTask.mjs";
import { findDateConflicts, describeConflict } from "../../domain/services/ConflictDetector.mjs";
import { findSilentOverdue } from "../../domain/services/OverdueAnalyzer.mjs";

const MAX_DESCRIPTION_CHARS = 1200;

const DEFAULT_REMINDER_MINUTES_BEFORE = 24 * 60;
const DEFAULT_CONFLICT_THRESHOLD_HOURS = 20;

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
    reminderMinutesBefore = DEFAULT_REMINDER_MINUTES_BEFORE,
    conflictThresholdHours = DEFAULT_CONFLICT_THRESHOLD_HOURS,
  }) {
    this.taskSource = taskSource;
    this.agenda = agenda;
    this.notifier = notifier;
    this.stateRepository = stateRepository;
    this.logger = logger;
    this.attachments = attachments;
    this.attachmentsDestDir = attachmentsDestDir;
    this.reminderMinutesBefore = reminderMinutesBefore;
    this.conflictThresholdHours = conflictThresholdHours;
  }

  async run() {
    let tasks, scanErrors;
    try {
      ({ tasks, scanErrors } = await this.taskSource.listAllTasks());
    } catch (err) {
      this.logger.log(`ERROR obteniendo tareas: ${err.message}`);
      await this.notifier
        .notify(`⚠️ No se pudo sincronizar tu fuente académica.\nError: ${err.message}`)
        .catch((e) => this.logger.log(`no se pudo avisar del error: ${e.message}`));
      throw err;
    }

    if (scanErrors?.length) {
      this.logger.log(`${scanErrors.length} curso(s) no se pudieron barrer: ${scanErrors.map((e) => e.courseName).join(", ")}`);
    }

    const state = await this.stateRepository.load();
    const prevTasks = state.tasks;
    const byCmid = new Map(tasks.filter((t) => t.cmid != null).map((t) => [String(t.cmid), t]));
    const newTasksState = {};
    const added = [];
    const dueChanged = [];
    const resolved = [];

    // Lo que ya estaba trackeado y dejó de estar pendiente (entregado, calificado
    // o desapareció): se cierra su reflejo en la agenda.
    for (const [cmid, prevEntry] of Object.entries(prevTasks)) {
      const current = byCmid.get(cmid);
      if (current && isPending(current)) continue;
      await this.agenda
        .close({ taskId: prevEntry.waconTaskId, eventId: prevEntry.waconEventId })
        .catch((e) => this.logger.log(`close falló para ${cmid}: ${e.message}`));
      resolved.push(prevEntry.title);
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

      newTasksState[cmid] = { ...prevEntry, title, submission: task.submission, dateConflict: task.dateConflict };

      if (task.dueDate !== prevEntry.dueDate) {
        const { eventId } = await this.agenda
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

    state.tasks = newTasksState;
    await this.stateRepository.save(state);

    const summary = { added, dueChanged, resolved, conflicts, silentOverdue };
    this.logger.log(
      `Resumen: +${added.length} nuevas, ${dueChanged.length} con fecha cambiada, ${resolved.length} resueltas, ` +
        `${conflicts.length} conflictos, ${silentOverdue.length} vencidas sin aviso.`,
    );

    // Las tareas nuevas ya se avisaron una por una (con indicaciones y adjuntos) dentro del
    // loop de arriba; este resumen agregado es solo para el resto de categorías.
    if (dueChanged.length || resolved.length || conflicts.length || silentOverdue.length) {
      await this.notifier.notify(buildSummaryMessage(summary)).catch((e) => this.logger.log(`notify falló: ${e.message}`));
    }

    return summary;
  }

  /** Descarga los adjuntos de una tarea (guías, rúbricas) a disco; nunca revienta el sync si falla. */
  async downloadAttachments(task) {
    if (!this.attachments || !this.attachmentsDestDir || !task.attachments?.length) return [];
    const paths = [];
    for (const a of task.attachments) {
      const dest = join(this.attachmentsDestDir, String(task.cmid), a.filename);
      const result = await this.attachments.downloadAttachment({ url: a.url, dest }).catch((e) => {
        this.logger.log(`downloadAttachment falló para "${a.filename}": ${e.message}`);
        return null;
      });
      if (result?.path) paths.push(result.path);
    }
    return paths;
  }
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

function buildSummaryMessage({ dueChanged, resolved, conflicts, silentOverdue }) {
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
  return lines.join("\n");
}
