import { SocialBriefingPort } from "../../application/ports/SocialBriefingPort.mjs";

export class WaconBriefingAdapter extends SocialBriefingPort {
  constructor(client) {
    super();
    this.client = client;
  }

  async getBriefing(sinceMinutes) {
    return this.client.rpc("briefing", [sinceMinutes]);
  }
}
