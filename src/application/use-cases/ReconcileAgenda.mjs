import { BRIDGE_TITLE_MARKERS } from "../../domain/entities/Reminder.mjs";

/**
 * Cruza lo que hay HOY en la agenda contra lo que el bridge cree haber creado.
 *
 * El sync escribe tareas y eventos en wacon pero nunca los leía de vuelta: si
 * el estado se perdía (o una corrida moría entre crear el evento y guardar el
 * estado), quedaban huérfanos disparando recordatorios de tareas que ya no
 * existen, y nadie se enteraba. Ahora se pueden ver y, si se pide, cerrar.
 *
 * Por defecto sólo reporta: borrar cosas de la agenda del usuario no es algo
 * que deba pasar sin que lo pida.
 */
export class ReconcileAgenda {
  constructor({ agenda, stateRepository, logger }) {
    this.agenda = agenda;
    this.stateRepository = stateRepository;
    this.logger = logger;
  }

  /** @param {{close?:boolean}} [opts] */
  async run({ close = false } = {}) {
    const [{ tasks, events }, state] = await Promise.all([this.agenda.listOwnItems(), this.stateRepository.load()]);

    const trackedTaskIds = new Set();
    const trackedEventIds = new Set();
    for (const entry of Object.values(state.tasks ?? {})) {
      if (entry.waconTaskId != null) trackedTaskIds.add(String(entry.waconTaskId));
      if (entry.waconEventId != null) trackedEventIds.add(String(entry.waconEventId));
    }

    const orphanTasks = tasks.filter((t) => isBridgeTitle(t.title) && !trackedTaskIds.has(String(t.id)));
    const orphanEvents = events.filter((e) => isBridgeTitle(e.title) && !trackedEventIds.has(String(e.id)));

    this.logger?.log(
      `Reconciliación: ${tasks.length} tarea(s) y ${events.length} evento(s) en la agenda; ` +
        `${orphanTasks.length} tarea(s) y ${orphanEvents.length} evento(s) huérfanos del bridge.`,
    );

    if (!close) return { orphanTasks, orphanEvents, closed: false };

    for (const task of orphanTasks) {
      await this.agenda.close({ taskId: task.id }).catch((e) => this.logger?.log(`no se pudo cerrar la tarea ${task.id}: ${e.message}`));
    }
    for (const event of orphanEvents) {
      await this.agenda.close({ eventId: event.id }).catch((e) => this.logger?.log(`no se pudo cancelar el evento ${event.id}: ${e.message}`));
    }
    return { orphanTasks, orphanEvents, closed: true };
  }
}

function isBridgeTitle(title) {
  return BRIDGE_TITLE_MARKERS.some((marker) => String(title ?? "").startsWith(marker));
}
