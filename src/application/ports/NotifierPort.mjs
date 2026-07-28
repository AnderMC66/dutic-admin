/** Canal de aviso hacia el humano. Hoy es WhatsApp (a uno mismo) vía wacon. */
export class NotifierPort {
  /** @param {string} text @param {string[]} [filePaths] rutas locales a adjuntar @returns {Promise<{sent:boolean, reason?:string}>} */
  async notify(text, filePaths = []) {
    throw new Error("not implemented");
  }
}
