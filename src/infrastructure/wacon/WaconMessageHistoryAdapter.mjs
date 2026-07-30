import { MessageHistoryPort } from "../../application/ports/MessageHistoryPort.mjs";

export class WaconMessageHistoryAdapter extends MessageHistoryPort {
  constructor(client) {
    super();
    this.client = client;
  }

  async readRecent({ chatJid, limit = 20 }) {
    const rows = await this.client.rpc("readMessages", [chatJid, limit]);
    return rows.map((m) => ({
      id: m.id,
      fromMe: Boolean(m.from_me),
      text: m.text,
      timestamp: m.timestamp,
      type: m.message_type ?? null,
    }));
  }
}
