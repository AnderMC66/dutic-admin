import { keywords } from "./CourseMatcher.mjs";

const EXTENSION_KEYWORDS = ["extien", "prorrog", "se mov", "nueva fecha", "amplia", "posterg", "se pasa", "cambio de fecha"];

function mentionsExtension(text) {
  const t = (text ?? "").toLowerCase();
  return EXTENSION_KEYWORDS.some((k) => t.includes(k));
}

/**
 * De las tareas ya vencidas y sin entregar, separa las que el grupo de
 * WhatsApp del curso ya explicó (alguien mencionó una prórroga/nueva fecha)
 * de las que están vencidas **en silencio** — la señal más urgente de
 * todas: nadie dijo nada y la fecha oficial ya pasó.
 * Puro: reusa los mismos `suggestedEvents` que ConflictDetector, sin I/O propio.
 */
export function findSilentOverdue(duticTasks, suggestedEvents, now = Date.now()) {
  const overdue = duticTasks.filter((t) => t.submission === "not-submitted" && t.dueDate && t.dueDate * 1000 < now);

  return overdue.map((task) => {
    const courseWords = keywords(task.courseName);
    const explained = suggestedEvents.some((s) => {
      const haystack = `${s.chatName ?? ""} ${s.title ?? ""} ${s.raw ?? ""}`;
      const overlaps = courseWords.some((w) => keywords(haystack).includes(w));
      return overlaps && mentionsExtension(s.raw ?? s.title ?? "");
    });
    return { task, silent: !explained };
  });
}
