import { readFileSync, existsSync } from "node:fs";
import { TargetChatPort } from "../../application/ports/TargetChatPort.mjs";
import { CONFIG_PATH, loadSettings } from "./FileSettings.mjs";

export { CONFIG_PATH };

/** Config del usuario, con fallback a tu propio JID si no se configuró nada. */
export class FileTargetChatConfig extends TargetChatPort {
  constructor(identity, logger) {
    super();
    this.identity = identity;
    this.logger = logger;
  }

  /**
   * No se cachea a propósito, a diferencia del resto de los ajustes: es un
   * archivo de menos de 1 KB, esto lo llama cada notify, y así se puede cambiar
   * el chat de destino sin reiniciar el listener, que corre por semanas.
   */
  async getChatJid() {
    if (!existsSync(CONFIG_PATH)) {
      // Deja el archivo creado con todos los ajustes y su documentación.
      loadSettings(this.logger);
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
