/** El "ponte al día" nativo de wacon: qué te falta responder, compromisos, agenda. */
export class SocialBriefingPort {
  /** @param {number} sinceMinutes @returns {Promise<object>} */
  async getBriefing(sinceMinutes) {
    throw new Error("not implemented");
  }
}
