import { AcademicChangesPort } from "../../application/ports/AcademicChangesPort.mjs";
import { execDutic } from "./execDutic.mjs";

/**
 * `dutic watch --json` compara contra su propia línea base y la actualiza al
 * correr. Eso significa que **este bridge pasa a ser el dueño de esa línea
 * base**: cada corrida consume las novedades. Si corrieras `dutic watch` a mano
 * verías "sin novedades", porque el bridge ya te las avisó por WhatsApp.
 *
 * La alternativa (`--no-save`) devolvería siempre el mismo diff desde la última
 * revisión manual, creciendo sin fin y sin poder crear la línea base la primera
 * vez, así que no sirve para un consumidor automático.
 */
export class DuticCliWatchAdapter extends AcademicChangesPort {
  async pullChanges() {
    const raw = await execDutic(["watch", "--json"], { timeout: 5 * 60_000, maxBuffer: 32 * 1024 * 1024 });
    const { changes, previousAt } = JSON.parse(raw);

    // Sin línea base previa, dutic la guarda y no reporta nada: es la primera
    // corrida, no un "no pasó nada".
    if (!previousAt || !changes) {
      return { firstRun: true, previousAt: previousAt ?? null, newTasks: [], submissionChanges: [], dueDateChanges: [], newGrades: [], gradeChanges: [] };
    }

    return {
      firstRun: false,
      previousAt,
      newTasks: changes.newTasks ?? [],
      submissionChanges: changes.submissionChanges ?? [],
      dueDateChanges: changes.dueDateChanges ?? [],
      newGrades: changes.newGrades ?? [],
      gradeChanges: changes.gradeChanges ?? [],
    };
  }
}
