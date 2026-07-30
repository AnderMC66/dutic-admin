import { MaterialsPort } from "../../application/ports/MaterialsPort.mjs";
import { execDutic } from "./execDutic.mjs";

/**
 * `dutic study` no tiene --json (imprime un resumen humano). En vez de
 * parsear su salida con fragilidad, confiamos en el exit code para saber si
 * funcionó y devolvemos el directorio destino, que es lo único que
 * necesita el caso de uso para avisar dónde quedó el material.
 */
export class DuticCliMaterialsAdapter extends MaterialsPort {
  async prepareCourseMaterials({ courseId, dest }) {
    const output = await execDutic(["study", String(courseId), "--dest", dest], { timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024 });
    return { dest: `${dest}/curso-${courseId}`, summary: output.trim().split("\n").slice(-3).join(" · ") };
  }

  async pullAllMaterials({ courseId, dest }) {
    const output = await execDutic(["pull", String(courseId), "--dest", dest], { timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024 });
    return { dest, summary: output.trim().split("\n").slice(-3).join(" · ") };
  }
}
