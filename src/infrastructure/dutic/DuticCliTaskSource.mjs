import { AcademicTaskSourcePort } from "../../application/ports/AcademicTaskSourcePort.mjs";
import { execDutic } from "./execDutic.mjs";

/**
 * Adaptador sobre el CLI de dutic-mcp. Requiere sesión ya iniciada
 * (`dutic login`, una vez); si expiró, dutic intenta renovarla sola con el
 * perfil de Chrome guardado — si eso también falla, el comando revienta y
 * el caso de uso decide qué hacer con el error (ver SyncAcademicTasks).
 */
export class DuticCliTaskSource extends AcademicTaskSourcePort {
  async listAllTasks() {
    const raw = execDutic(["tasks", "--all", "--json"], { timeout: 5 * 60_000, maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(raw); // { tasks: Task[], scanErrors: [...] }
  }
}
