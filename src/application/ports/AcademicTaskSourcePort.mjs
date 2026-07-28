/**
 * Fuente de tareas académicas. Hoy la implementa dutic-mcp vía CLI; mañana
 * podría ser un adaptador para otro campus/sistema sin tocar el caso de uso.
 */
export class AcademicTaskSourcePort {
  /** @returns {Promise<{tasks: object[], scanErrors: object[]}>} */
  async listAllTasks() {
    throw new Error("not implemented");
  }
}
