import { ChatDirectoryPort } from "../../application/ports/ChatDirectoryPort.mjs";

const DEFAULT_LIMIT = 200;

export class WaconChatDirectoryAdapter extends ChatDirectoryPort {
  constructor(client) {
    super();
    this.client = client;
  }

  async listChats(limit = DEFAULT_LIMIT) {
    const rows = await this.client.rpc("listChats", [limit]);
    return rows.map((c) => ({
      jid: c.jid,
      name: c.display_name ?? c.name ?? null,
      // Los grupos de WhatsApp siempre terminan en @g.us; es más confiable que
      // depender de una columna que puede venir en 0/1, true/false o ausente.
      isGroup: String(c.jid ?? "").endsWith("@g.us"),
      lastMessageAt: c.last_message_ts ?? null,
    }));
  }
}
