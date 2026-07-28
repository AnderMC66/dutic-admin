import { TriggerSourcePort } from "../../application/ports/TriggerSourcePort.mjs";

export class WaconTriggerAdapter extends TriggerSourcePort {
  constructor(client) {
    super();
    this.client = client;
  }

  async waitForTriggers({ msgCursor, triggerCursor, timeoutSeconds = 110 } = {}) {
    return this.client.rpc("waitForTriggers", [{ sinceMsg: msgCursor, sinceTrigger: triggerCursor, timeoutSeconds }]);
  }
}
