/** Los chats que conoce el canal de mensajería, para poder proponer el mapeo curso→grupo. */
export class ChatDirectoryPort {
  /** @param {number} [limit] @returns {Promise<Array<{jid:string, name:string|null, isGroup:boolean, lastMessageAt:number|null}>>} */
  async listChats(limit) {
    throw new Error("not implemented");
  }
}
