/**
 * Motor proactivo de la agenda (hoy: wait_for_triggers de wacon, long-poll).
 * Devuelve los eventos cuya hora de aviso ya llegó desde el último cursor.
 */
export class TriggerSourcePort {
  /**
   * @param {{msgCursor?:number, triggerCursor?:number, timeoutSeconds?:number}} opts
   * @returns {Promise<{triggers: Array<{eventId:any, chat:string|null, chatName:string|null, title:string, startsAt:string, minutesUntilStart:number|null, notes:string|null}>, msgCursor:number, triggerCursor:number, timedOut:boolean}>}
   */
  async waitForTriggers(opts) {
    throw new Error("not implemented");
  }
}
