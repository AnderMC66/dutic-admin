/**
 * A qué chat de WhatsApp van los avisos y de dónde se leen los comandos.
 * Por defecto es tu propio chat ("Mensajes para mí"), pero eso NO
 * sincroniza mensajes escritos desde el teléfono hacia una sesión
 * vinculada (limitación de WhatsApp/Baileys, no de este bridge) — por eso
 * se puede apuntar a un grupo en su lugar.
 */
export class TargetChatPort {
  /** @returns {Promise<string|null>} */
  async getChatJid() {
    throw new Error("not implemented");
  }
}
