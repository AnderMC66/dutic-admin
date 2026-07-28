import { keywords } from "./CourseMatcher.mjs";

/**
 * Cruza tareas oficiales de DUTIC contra los "accionables" que wacon ya
 * extrajo de los grupos de WhatsApp de curso (wacon init --courses).
 * Heurística simple por palabras clave del nombre del curso — suficiente
 * para el caso real: "el grupo dice viernes, Moodle dice jueves".
 * Puro: no hace I/O, solo compara datos ya obtenidos.
 */
export function findDateConflicts(duticTasks, suggestedEvents, alreadyFlagged, thresholdHours = 20) {
  const conflicts = [];
  const pending = duticTasks.filter((t) => t.submission === "not-submitted" && t.dueDate);

  for (const task of pending) {
    const courseWords = keywords(task.courseName);
    if (!courseWords.length) continue;

    for (const s of suggestedEvents) {
      if (!s.when) continue;
      const haystack = keywords(`${s.chatName ?? ""} ${s.title ?? ""} ${s.raw ?? ""}`);
      const overlaps = courseWords.some((w) => haystack.includes(w));
      if (!overlaps) continue;

      const dutyMs = task.dueDate * 1000; // dutic dueDate viene en epoch segundos
      const suggestedMs = new Date(s.when).getTime();
      const diffHours = Math.abs(dutyMs - suggestedMs) / 3_600_000;
      if (diffHours < thresholdHours) continue;

      const key = `${task.cmid}:${s.id}`;
      if (alreadyFlagged.includes(key)) continue;

      conflicts.push({ key, task, suggested: s, diffHours });
    }
  }
  return conflicts;
}

/** Convierte un conflicto detectado en el título/notas que se muestran en la agenda. */
export function describeConflict(conflict) {
  const { task, suggested } = conflict;
  const title = `⚠️ Conflicto de fecha: ${task.courseName}`;
  const notes = [
    `Tarea: ${task.name}`,
    `Moodle (oficial): ${new Date(task.dueDate * 1000).toLocaleString("es-PE")}`,
    `Grupo de WhatsApp (${suggested.chatName ?? "curso"}): ${new Date(suggested.when).toLocaleString("es-PE")}`,
    suggested.raw ? `Mensaje: "${suggested.raw}"` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return { title, notes, dueDateIso: task.dueDate ? new Date(task.dueDate * 1000).toISOString() : undefined };
}
