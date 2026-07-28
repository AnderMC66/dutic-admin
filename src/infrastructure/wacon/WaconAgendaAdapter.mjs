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

  async reschedule({ eventId, title, dueDateIso, notes, notifyBeforeMinutes }) {
    if (eventId) await this.client.rpc("cancelEvent", [eventId]).catch(() => {});
    if (!dueDateIso) return {};
    const ev = await this.client.rpc("scheduleEvent", [{ title, start: dueDateIso, notifyBeforeMinutes, notes }]).catch(() => null);
    return { eventId: ev?.id };
  }

  async close({ taskId, eventId }) {
    if (taskId) await this.client.rpc("completeTask", [taskId]);
    if (eventId) await this.client.rpc("cancelEvent", [eventId]);
  }

  async flagConflict({ title, dueDateIso, notes }) {
    const taskRow = await this.client.rpc("addTask", [{ title, due: dueDateIso, notes }]);
    return { taskId: taskRow.id };
  }

  async listSuggestedEvents() {
    return this.client.rpc("listSuggestedEvents", ["suggested", 200]);
  }
}
