/**
 * Lee el contenido de un mensaje que no es texto (una nota de voz, una foto de
 * la pizarra). Puede NO poder hacerlo: wacon sólo transcribe si hay un backend
 * de transcripción/visión configurado, y si no devuelve el audio crudo para que
 * lo escuche un agente. Este bridge es un proceso Node sin modelo, así que en
 * ese caso no hay nada que leer — por eso el contrato distingue "no pude" de
 * "no decía nada".
 */
export class MediaReaderPort {
  /**
   * @param {{chatJid:string, messageId:string, type:string}} message
   * @returns {Promise<{readable:boolean, text:string|null, reason?:string}>}
   */
  async readMedia(message) {
    throw new Error("not implemented");
  }
}
