import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TargetChatPort } from "../../application/ports/TargetChatPort.mjs";
import { ensureBridgeDir, BRIDGE_DIR } from "../paths.mjs";

export const CONFIG_PATH = join(BRIDGE_DIR, "config.json");

const TEMPLATE = {
  _readme:
    "commandChatJid: a qué chat van los avisos y de dónde se leen los comandos ('!brief', etc). " +
    "Vacío = tu propio chat ('Mensajes para mí'), pero ese chat NO sincroniza mensajes escritos desde " +
    "el teléfono hacia una sesión vinculada (limitación de WhatsApp/Baileys) — si querés usar comandos " +
    "desde tu celular, poné acá el JID de un grupo donde seas el único miembro (ver 'wacon chats --json').",
  commandChatJid: null,
};

/** Config del usuario, con fallback a tu propio JID si no se configuró nada. */
export class FileTargetChatConfig extends TargetChatPort {
  constructor(identity, logger) {
    super();
    this.identity = identity;
    this.logger = logger;
  }

  /**
   * No se cachea a propósito: es un archivo de menos de 1 KB y esto lo llama
   * cada notify, así que releerlo sale gratis y permite cambiar el chat de
   * destino sin reiniciar el listener, que corre por semanas.
   */
  async getChatJid() {
    if (!existsSync(CONFIG_PATH)) {
      ensureBridgeDir();
      writeFileSync(CONFIG_PATH, JSON.stringify(TEMPLATE, null, 2));
      return this.identity.getSelfJid();
    }

    try {
      const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
      if (config.commandChatJid) return config.commandChatJid;
    } catch (err) {
      // Un config.json editado a mano y roto no puede tumbar el sync entero: se
      // cae al chat propio, que es el default documentado en el template.
      this.logger?.log(`config.json ilegible (${err.message}); uso tu propio chat como destino.`);
    }
    return this.identity.getSelfJid();
  }
}
