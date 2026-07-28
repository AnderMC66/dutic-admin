/** Persistencia del estado de sincronización (qué tareas ya se reflejaron, qué conflictos ya se avisaron). */
export class StateRepositoryPort {
  async load() {
    throw new Error("not implemented");
  }
  /** @param {object} state */
  async save(state) {
    throw new Error("not implemented");
  }
}
