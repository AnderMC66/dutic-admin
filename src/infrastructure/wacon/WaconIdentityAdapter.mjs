import { IdentityPort } from "../../application/ports/IdentityPort.mjs";

export class WaconIdentityAdapter extends IdentityPort {
  constructor(client) {
    super();
    this.client = client;
  }

  async getSelfJid() {
    return this.client.getSelfJid();
  }
}
