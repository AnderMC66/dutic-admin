import { keywords } from "./CourseMatcher.mjs";
import { isPending } from "../entities/AcademicTask.mjs";

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
  // isPending() en vez de repetir el literal "not-submitted".
  const overdue = duticTasks.filter((t) => isPending(t) && t.dueDate && t.dueDate * 1000 < now);

  // Cada evento se normaliza una sola vez. Antes keywords(haystack) estaba DENTRO
  // del some(), así que se recalculaba por cada palabra de cada curso: con 200
  // eventos sugeridos eran miles de normalizaciones repetidas por corrida.
  const indexed = (suggestedEvents ?? []).map((s) => ({
    words: keywords(`${s.chatName ?? ""} ${s.title ?? ""} ${s.raw ?? ""}`),
    explains: mentionsExtension(s.raw ?? s.title ?? ""),
  }));

  return overdue.map((task) => {
    const courseWords = keywords(task.courseName);
    const explained = indexed.some((s) => s.explains && courseWords.some((w) => s.words.includes(w)));
    return { task, silent: !explained };
  });
}
