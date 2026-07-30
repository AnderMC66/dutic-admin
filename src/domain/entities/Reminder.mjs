/**
 * Un "trigger" de wacon (evento de agenda cuya hora de aviso llegó) puede
 * venir de cualquier cliente que use scheduleEvent — no solo de este
 * bridge. Se reconocen los propios por el prefijo que pone
 * SyncAcademicTasks/ConflictDetector/OverdueAnalyzer en el título.
 */
/** Exportado para que la reconciliación reconozca en la agenda lo que puso este bridge. */
export const BRIDGE_TITLE_MARKERS = ["[DUTIC]", "⚠️ Conflicto de fecha"];

export function isBridgeReminder(trigger) {
  return BRIDGE_TITLE_MARKERS.some((marker) => trigger.title?.startsWith(marker));
}

export function buildReminderText(trigger) {
  const lines = [`⏰ *Recordatorio:* ${trigger.title}`];
  if (trigger.minutesUntilStart != null) {
    const hours = Math.round(trigger.minutesUntilStart / 60);
    lines.push(hours >= 1 ? `Vence en ~${hours}h.` : `Vence en ${trigger.minutesUntilStart} min.`);
  }
  if (trigger.notes) lines.push(`\n${trigger.notes}`);
  return lines.join("\n");
}
