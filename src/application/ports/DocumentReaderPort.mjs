/** Convierte un documento local (PDF) a texto/Markdown legible (hoy: `dutic md`). */
export class DocumentReaderPort {
  /** @param {{path:string, maxChars?:number}} input @returns {Promise<string|null>} null si no se pudo leer */
  async toMarkdown(input) {
    throw new Error("not implemented");
  }
}
