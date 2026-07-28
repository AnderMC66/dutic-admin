/**
 * Reglas puras sobre una tarea académica (forma cruda que ya entrega dutic-mcp:
 * { cmid, name, courseName, dueDate (epoch seconds), submission, url, dateConflict, ... }).
 * Nada aquí toca red, disco ni procesos — por eso vive en domain/.
 */

export function isPending(task) {
  return task.submission === "not-submitted" && task.cmid != null;
}

export function taskTitle(task) {
  return `[DUTIC] ${task.courseName}: ${task.name}`;
}

export function dueDateIso(task) {
  return task.dueDate ? new Date(task.dueDate * 1000).toISOString() : undefined;
}

const EXAM_KEYWORDS = /examen|parcial|final(?!.*trabajo)|evaluaci[oó]n/i;

export function isExamTask(task) {
  return EXAM_KEYWORDS.test(task.name);
}

/** true si la tarea pendiente vence dentro de `days` días (y no ya venció). */
export function isDueWithin(task, days, now = Date.now()) {
  if (!task.dueDate) return false;
  const msUntilDue = task.dueDate * 1000 - now;
  return msUntilDue >= 0 && msUntilDue <= days * 86_400_000;
}
