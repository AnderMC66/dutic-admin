/**
 * Notas parciales de SISACAD (extranet.unsa.edu.pe) ya capturadas — el login
 * y el CAPTCHA los resuelve el humano manualmente (`dutic sisacad`), nunca
 * este puerto. Puede no haber nada capturado todavía.
 */
export class SisacadSourcePort {
  /** @returns {Promise<{courses: Array<{subject:string, weightedAverageSoFar:number|null}>} | null>} */
  async loadCaptured() {
    throw new Error("not implemented");
  }
}
