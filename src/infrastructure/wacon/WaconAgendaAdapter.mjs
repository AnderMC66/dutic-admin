import { AgendaPort } from "../../application/ports/AgendaPort.mjs";

/** Traduce el vocabulario de AgendaPort a las llamadas RPC concretas de wacon. */
export class WaconAgendaAdapter extends AgendaPort {
  constructor(client) {
    super();
    this.client = client;
  }

  async upsertPendingTask({ title, dueDateIso, notes, notifyBeforeMinutes }) {
    const taskRow = await this.client.rpc("addTask", [{ title, due: dueDateIso, notes }]);
    let eventId;
    if (dueDateIso) {
      const ev = await this.client.rpc("scheduleEvent", [{ title, start: dueDateIso, notifyBeforeMinutes, notes }]).catch(() => null);
      eventId = ev?.id;
    }
    return { taskId: taskRow.id, eventId };
  }

  /**
   * Reprograma el evento Y la tarea. wacon no expone ningún `updateTask` (ver
   * el whitelist RPC en daemon/server.ts), así que la única forma de que
   * `wacon tasks` deje de mostrar la fecha vieja para siempre es reemplazar la
   * fila: se crea la nueva ANTES de cerrar la anterior, para que un fallo a
   * mitad de camino nunca te deje sin tarea. `completeTask` solo pone done=1 y
   * `listTasks` oculta las hechas por defecto, así que la vieja desaparece de
   * la lista en vez de quedar duplicada.
   */
  async reschedule({ taskId, eventId, title, dueDateIso, notes, notifyBeforeMinutes }) {
    if (eventId) await this.client.rpc("cancelEvent", [eventId]).catch(() => {});

    let currentTaskId = taskId;
    if (taskId) {
      const replacement = await this.client.rpc("addTask", [{ title, due: dueDateIso, notes }]).catch(() => null);
      if (replacement?.id) {
        currentTaskId = replacement.id;
        await this.client.rpc("completeTask", [taskId]).catch(() => {});
      }
    }

    if (!dueDateIso) return { taskId: currentTaskId };
    const ev = await this.client.rpc("scheduleEvent", [{ title, start: dueDateIso, notifyBeforeMinutes, notes }]).catch(() => null);
    return { taskId: currentTaskId, eventId: ev?.id };
  }

  /**
   * Los dos lados se intentan por separado a propósito: si `completeTask`
   * fallaba, antes `cancelEvent` no llegaba a correr y el evento quedaba
   * huérfano disparando recordatorios de una tarea ya entregada. Igual se
   * informa el fallo al llamador (que lo loguea).
   */
  async close({ taskId, eventId }) {
    const errors = [];
    if (taskId) await this.client.rpc("completeTask", [taskId]).catch((e) => errors.push(`completeTask: ${e.message}`));
    if (eventId) await this.client.rpc("cancelEvent", [eventId]).catch((e) => errors.push(`cancelEvent: ${e.message}`));
    if (errors.length) throw new Error(errors.join("; "));
  }

  async flagConflict({ title, dueDateIso, notes }) {
    const taskRow = await this.client.rpc("addTask", [{ title, due: dueDateIso, notes }]);
    return { taskId: taskRow.id };
  }

  async listSuggestedEvents() {
    return this.client.rpc("listSuggestedEvents", ["suggested", 200]);
  }
}
