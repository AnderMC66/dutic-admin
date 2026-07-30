import { MessageSearchPort } from "../../application/ports/MessageSearchPort.mjs";

export class WaconMessageSearchAdapter extends MessageSearchPort {
  constructor(client) {
    super();
    this.client = client;
  }

  async search({ query, chatJid, limit = 15 }) {
    const rows = await this.client.rpc("searchMessages", [query, chatJid, limit]);
    return rows.map((m) => ({
      id: m.id,
      text: m.text ?? null,
      snippet: m.snippet ?? null,
      timestamp: m.timestamp,
      fromMe: Boolean(m.from_me),
    }));
  }
}
