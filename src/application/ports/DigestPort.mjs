/** Resumen comprimido de actividad reciente por chat (hoy: wacon digest). */
export class DigestPort {
  /** @param {number} sinceMinutes @returns {Promise<{since:string, totalIncoming:number, chats:Array<{chat:string,name:string|null,isGroup:boolean,incoming:number,lastAt:string,preview:string|null}>}>} */
  async getDigest(sinceMinutes) {
    throw new Error("not implemented");
  }
}
