/** Descarga y prepara el material de estudio de un curso (hoy: dutic study/pull). */
export class MaterialsPort {
  /** @param {{courseId:number, dest:string}} input @returns {Promise<{dest:string, summary:string}>} */
  async prepareCourseMaterials(input) {
    throw new Error("not implemented");
  }

  /**
   * Descarga TODO el material de un curso (más amplio que prepareCourseMaterials, sin convertir a Markdown).
   * @param {{courseId:number, dest:string}} input @returns {Promise<{dest:string, summary:string}>} */
  async pullAllMaterials(input) {
    throw new Error("not implemented");
  }
}
