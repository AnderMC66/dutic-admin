import { TeachersSourcePort } from "../../application/ports/TeachersSourcePort.mjs";
import { execDutic } from "./execDutic.mjs";

/**
 * `dutic teachers` no tiene --json. Como corre sin TTY (child_process), el
 * propio CLI ya desactiva colores solo (ver cli/ui.ts: `isTTY`), así que la
 * salida es texto plano; cada docente sale en una línea "• Nombre".
 */
export class DuticCliTeachersAdapter extends TeachersSourcePort {
  async listCourseTeachers(courseId) {
    const output = execDutic(["teachers", String(courseId)], { timeout: 60_000 });
    return output
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("•"))
      .map((l) => l.slice(1).trim());
  }
}
