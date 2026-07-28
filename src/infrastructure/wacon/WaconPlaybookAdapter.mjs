import { PlaybookPort } from "../../application/ports/PlaybookPort.mjs";

export class WaconPlaybookAdapter extends PlaybookPort {
  constructor(client) {
    super();
    this.client = client;
  }

  async consult({ chatJid, situation }) {
    return this.client.rpc("consultPlaybook", [chatJid, situation]);
  }
}
