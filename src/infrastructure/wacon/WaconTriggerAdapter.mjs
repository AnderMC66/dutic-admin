import { TriggerSourcePort } from "../../application/ports/TriggerSourcePort.mjs";

export class WaconTriggerAdapter extends TriggerSourcePort {
  constructor(client) {
    super();
    this.client = client;
  }

  /** @param {{msgCursor?:number, triggerCursor?:number, timeoutSeconds?:number}} opts */
  async waitForTriggers({ msgCursor, triggerCursor, timeoutSeconds = 110 } = {}) {
    // Es un long-poll: el timeout del transporte tiene que ser MAYOR que el que
    // le pedimos al daemon, para que gane el suyo (que contesta "timedOut" de
    // forma ordenada) y no el nuestro (que aborta la conexión).
    return this.client.rpc("waitForTriggers", [{ sinceMsg: msgCursor, sinceTrigger: triggerCursor, timeoutSeconds }], {
      timeoutMs: (timeoutSeconds + 20) * 1000,
    });
  }
}
