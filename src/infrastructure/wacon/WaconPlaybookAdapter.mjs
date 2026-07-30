import { PlaybookPort } from "../../application/ports/PlaybookPort.mjs";

export class WaconPlaybookAdapter extends PlaybookPort {
  constructor(client) {
    super();
    this.client = client;
  }

  async consult({ chatJid, situation }) {
    // Del otro lado hay una consulta a NotebookLM: puede tardar bastante más que
    // cualquier otra llamada al daemon.
    return this.client.rpc("consultPlaybook", [chatJid, situation], { timeoutMs: 4 * 60_000 });
  }
}
