const LIMA_OFFSET_MS = 5 * 3_600_000; // UTC-5, Perú no usa horario de verano

function limaParts(nowMs) {
  const shifted = new Date(nowMs - LIMA_OFFSET_MS);
  return { dateStr: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
}

/**
 * true si ya pasó la hora configurada (hora de Lima) y todavía no se mandó
 * el brief de hoy. Puro: solo compara fechas/horas, sin tocar el reloj del
 * sistema salvo por el `now` que se le pasa.
 */
export function isDailyBriefDue(hour, lastSentDateStr, now = Date.now()) {
  const { dateStr, hour: currentHour } = limaParts(now);
  return currentHour >= hour && dateStr !== lastSentDateStr;
}

export function limaDateStr(now = Date.now()) {
  return limaParts(now).dateStr;
}
