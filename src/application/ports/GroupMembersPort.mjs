/** Miembros de un grupo de WhatsApp (hoy: wacon-mcp). */
export class GroupMembersPort {
  /** @param {string} chatJid @returns {Promise<{groupName:string|null, members: Array<{name:string|null}>}>} */
  async listGroupMembers(chatJid) {
    throw new Error("not implemented");
  }
}
