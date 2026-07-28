import { namesMatch } from "./NameMatcher.mjs";

const DEFAULT_WEIGHT_PERCENT = 10; // cuando no se pudo identificar el peso real del ítem
const MIN_DAYS_LEFT = 0.25; // evita dividir por ~0 en tareas que vencen ya

/** "20,00 %( Vacío )" → 20. null si no se pudo leer. */
function parseWeightPercent(raw) {
  const m = /(-?\d+(?:[.,]\d+)?)/.exec(raw ?? "");
  if (!m) return null;
  const n = Number.parseFloat(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Encuentra, dentro de los ítems de notas del curso, el que probablemente corresponde a esta tarea. */
function findGradeItem(task, gradeItems) {
  if (!gradeItems) return null;
  return gradeItems.find((item) => !item.isTotal && namesMatch(task.name, item.name)) ?? null;
}

/**
 * Ordena tareas pendientes no solo por fecha, sino por "qué tan caro sale
 * NO estudiarla ya" — combinando el peso real de la evaluación en la nota
 * (cuando se puede identificar el ítem correspondiente en la libreta) con
 * la urgencia (días que quedan). Puro: solo combina datos ya obtenidos.
 */
export function rankByStudyPriority(tasks, gradeItemsByCourseId, now = Date.now()) {
  return tasks
    .map((task) => {
      const item = findGradeItem(task, gradeItemsByCourseId.get(task.courseId));
      const weightPercent = item ? parseWeightPercent(item.weight) : null;
      const effectiveWeight = weightPercent && weightPercent > 0 ? weightPercent : DEFAULT_WEIGHT_PERCENT;
      const daysLeft = task.dueDate != null ? Math.max((task.dueDate * 1000 - now) / 86_400_000, MIN_DAYS_LEFT) : null;
      const priorityScore = daysLeft != null ? Number((effectiveWeight / daysLeft).toFixed(2)) : 0;
      return { task, weightPercent, daysLeft, priorityScore };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore);
}
