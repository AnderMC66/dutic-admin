/**
 * Agenda/tareas donde se refleja el trabajo académico pendiente. Hoy la
 * implementa wacon vía su RPC; el caso de uso no sabe que es WhatsApp.
 */
export class AgendaPort {
  /** @param {{title:string, dueDateIso?:string, notes?:string, notifyBeforeMinutes?:number}} input
   *  @returns {Promise<{taskId:any, eventId?:any}>} */
  async upsertPendingTask(input) {
    throw new Error("not implemented");
  }

  /** @param {{taskId:any, eventId?:any, title:string, dueDateIso?:string, notes?:string, notifyBeforeMinutes?:number}} input
   *  @returns {Promise<{eventId?:any}>} */
  async reschedule(input) {
    throw new Error("not implemented");
  }

  /** @param {{taskId:any, eventId?:any}} input */
  async close(input) {
    throw new Error("not implemented");
  }

  /** @param {{title:string, dueDateIso?:string, notes?:string}} conflict */
  async flagConflict(conflict) {
    throw new Error("not implemented");
  }

  /** @returns {Promise<Array<{id:any, chatName?:string, title?:string, raw?:string, when?:string}>>} */
  async listSuggestedEvents() {
    throw new Error("not implemented");
  }
}
