/** Escribe contenido generado (no descargado) a disco — ej. un .ics armado en memoria. */
export class FileWriterPort {
  /** @param {{path:string, content:string}} input @returns {Promise<void>} */
  async write(input) {
    throw new Error("not implemented");
  }
}
