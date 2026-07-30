/**
 * Historial crudo de un chat (hoy: wacon readMessages). A diferencia de
 * TriggerSourcePort, esto SÍ incluye tus propios mensajes — necesario
 * porque wacon descarta a propósito los mensajes from_me de su sistema de
 * atención ("nuestros propios envíos nunca despiertan a un agente"), y los
 * comandos de este bridge son justamente mensajes tuyos.
 */
export class MessageHistoryPort {
  /**
   * `type` distingue los mensajes que no son texto ("audio", "image", ...): sin
   * él, una nota de voz llega como un mensaje vacío y es indistinguible de que
   * nadie haya dicho nada.
   * @param {{chatJid:string, limit?:number}} input
   * @returns {Promise<Array<{id:string, fromMe:boolean, text:string|null, timestamp:number, type:string|null}>>} */
  async readRecent(input) {
    throw new Error("not implemented");
  }
}
