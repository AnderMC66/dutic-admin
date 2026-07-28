import { NotifierPort } from "../../application/ports/NotifierPort.mjs";

const CLIENT_NAME = "dutic-wacon-bridge";

/** Manda el aviso por WhatsApp al chat configurado (ver TargetChatPort). Si no hay sesión, degrada sin romper el sync. */
export class WaconNotifier extends NotifierPort {
  constructor(client, targetChat, logger) {
    super();
    this.client = client;
    this.targetChat = targetChat;
    this.logger = logger;
  }

  async notify(text, filePaths = []) {
    const chatJid = await this.targetChat.getChatJid();
    if (!chatJid) {
      this.logger?.log("Aviso: no se pudo resolver el chat de destino (¿sesión de WhatsApp caída?). No se pudo mandar el aviso.");
      return { sent: false, reason: "no-target-chat" };
    }
    await this.client.rpc("send", [chatJid, text, CLIENT_NAME, 0]);
    for (const filePath of filePaths) {
      await this.client.rpc("sendFile", [chatJid, filePath, { clientName: CLIENT_NAME }]).catch((e) => {
        this.logger?.log(`sendFile falló para ${filePath}: ${e.message}`);
      });
    }
    return { sent: true };
  }
}
