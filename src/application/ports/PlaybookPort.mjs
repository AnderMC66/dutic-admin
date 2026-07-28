/** Consulta el playbook externo (NotebookLM) que wacon ya sabe usar para chats etiquetados. */
export class PlaybookPort {
  /** @param {{chatJid:string, situation:string}} input @returns {Promise<object>} */
  async consult(input) {
    throw new Error("not implemented");
  }
}
