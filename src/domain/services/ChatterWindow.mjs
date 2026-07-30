const DEFAULT_BEFORE_DAYS = 5;
const DEFAULT_AFTER_DAYS = 2;
const READABLE_MEDIA = new Set(["audio", "image"]);

/**
 * Recorta los mensajes de un grupo a la ventana que rodea al vencimiento de una
 * tarea. Puro: recibe los mensajes ya leídos y sólo filtra.
 *
 * La ventana es asimétrica a propósito: los anuncios de prórroga aparecen sobre
 * todo en los días PREVIOS al vencimiento, y algo después (el "profe dijo que
 * lo recibe hasta mañana"), pero nada de lo que se hable dos semanas antes
 * explica una fecha que ya pasó.
 */
export function messagesAroundDue(messages, dueDateSeconds, { beforeDays = DEFAULT_BEFORE_DAYS, afterDays = DEFAULT_AFTER_DAYS } = {}) {
  if (!dueDateSeconds) return [];
  const dueMs = dueDateSeconds * 1000;
  const from = dueMs - beforeDays * 86_400_000;
  const to = dueMs + afterDays * 86_400_000;
  return messages.filter((m) => m.timestamp >= from && m.timestamp <= to);
}

/**
 * Separa lo que se puede leer de lo que no. Una nota de voz o una foto de la
 * pizarra llegan sin texto: tratarlas como "mensaje vacío" es lo que hacía que
 * un anuncio de prórroga contara como silencio.
 */
export function splitByReadability(messages) {
  const text = [];
  const media = [];
  for (const m of messages) {
    if (m.text?.trim()) text.push(m);
    else if (READABLE_MEDIA.has(m.type)) media.push(m);
  }
  return { text, media };
}
