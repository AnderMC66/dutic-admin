/** Descarga un adjunto de una tarea (guía, rúbrica, enunciado) a disco local. */
export class AttachmentsPort {
  /** @param {{url:string, dest:string}} input @returns {Promise<{path:string}|null>} */
  async downloadAttachment(input) {
    throw new Error("not implemented");
  }
}
