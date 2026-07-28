const STOPWORDS = new Set(["de", "del", "la", "el", "los", "las", "y", "en", "para", "curso", "2026a", "2026b"]);

function keywords(text) {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita tildes para matchear "álgebra" ~ "algebra"
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

/**
 * Cruza tareas oficiales de DUTIC contra los "accionables" que wacon ya
 * extrajo de los grupos de WhatsApp de curso (wacon init --courses).
 * Heurística simple por palabras clave del nombre del curso — suficiente
 * para el caso real: "el grupo dice viernes, Moodle dice jueves".
 */
export function findDateConflicts(duticTasks, suggestedEvents, alreadyFlagged) {
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
      if (diffHours < 20) continue; // menos de ~1 día de diferencia: no vale la pena avisar

      const key = `${task.cmid}:${s.id}`;
      if (alreadyFlagged.includes(key)) continue;

      conflicts.push({ key, task, suggested: s, diffHours });
    }
  }
  return conflicts;
}
