import { DigestPort } from "../../application/ports/DigestPort.mjs";

export class WaconDigestAdapter extends DigestPort {
  constructor(client) {
    super();
    this.client = client;
  }

  async getDigest(sinceMinutes) {
    // limit alto: el digest global se filtra por chat después, así que no
    // queremos que el grupo del curso quede afuera por el tope por defecto.
    return this.client.rpc("digest", [sinceMinutes, 200]);
  }
}
