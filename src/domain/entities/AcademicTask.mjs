/**
 * Reglas puras sobre una tarea académica (forma cruda que ya entrega dutic-mcp:
 * { cmid, name, courseName, dueDate (epoch seconds), submission, url, dateConflict, ... }).
 * Nada aquí toca red, disco ni procesos — por eso vive en domain/.
 */

export function isPending(task) {
  return task.submission === "not-submitted" && task.cmid != null;
}

/**
 * true si la fuente no pudo determinar el estado de entrega.
 *
 * dutic crea TODAS las tareas con submission "unknown" —tanto las del barrido
 * de curso como las del calendario— y recién el enriquecimiento les pone el
 * estado real; ese enriquecimiento traga sus propios fallos por tarea (ver
 * dutic-mcp domain/tasks.ts, enrichTask). O sea que una tarea que quedó en
 * "unknown" es una cuyo detalle no se pudo leer, NO una entregada.
 *
 * Hace falta distinguirlas porque si no desaparecen del producto entero:
 * isPending() las descarta (y ese predicado es la puerta del sync, del brief,
 * del .ics y de los recordatorios) y scanErrors tampoco las reporta, porque
 * sólo cubre cursos que fallaron completos. Quedarían indistinguibles de una
 * tarea ya entregada.
 */
export function isStateUnknown(task) {
  return task.submission === "unknown" && task.cmid != null;
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
