import { GroupMembersPort } from "../../application/ports/GroupMembersPort.mjs";

export class WaconGroupMembersAdapter extends GroupMembersPort {
  constructor(client) {
    super();
    this.client = client;
  }

  async listGroupMembers(chatJid) {
    const result = await this.client.rpc("groupMembers", [chatJid, 1]);
    return { groupName: result.groupName, members: result.members };
  }
}
