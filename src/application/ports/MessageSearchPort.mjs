/** Búsqueda en el historial de mensajes ya guardado (hoy: searchMessages de wacon). */
export class MessageSearchPort {
  /**
   * @param {{query:string, chatJid?:string, limit?:number}} input
   * @returns {Promise<Array<{id:string, text:string|null, snippet:string|null, timestamp:number, fromMe:boolean}>>}
   */
  async search(input) {
    throw new Error("not implemented");
  }
}
