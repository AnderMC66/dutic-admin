const CRLF = "\r\n";
const MAX_OCTETS_PER_LINE = 75; // RFC 5545 §3.1
const DEFAULT_EVENT_MINUTES = 30;
const DEFAULT_ALARM_MINUTES_BEFORE = 24 * 60;

/** Escapa texto para un campo iCalendar (RFC 5545 §3.3.11). */
function escapeIcsText(text) {
  return (
    String(text ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n")
      // Cualquier otro carácter de control sobreviviente rompe el archivo. Se usa
      // \p{Cc} y no un rango escrito a mano: los saltos de línea ya se
      // convirtieron arriba, así que acá solo quedan los invisibles.
      .replace(/\p{Cc}/gu, "")
  );
}

function toIcsUtc(epochMs) {
  return new Date(epochMs).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

/**
 * Plegado de líneas de RFC 5545 §3.1: ninguna línea puede pasar de 75 OCTETOS
 * (no caracteres — con tildes, "ó" ocupa 2 bytes en UTF-8, y los nombres de tus
 * cursos son largos: "26A ECONOMÍA: DESARROLLO EMOCIONAL, GESTIÓN DE..." pasa el
 * límite sola). Las continuaciones arrancan con un espacio.
 *
 * Se corta por octetos cuidando de no partir un carácter multibyte al medio, que
 * dejaría el archivo con UTF-8 inválido.
 */
function foldLine(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= MAX_OCTETS_PER_LINE) return line;

  const chunks = [];
  let start = 0;
  while (start < bytes.length) {
    // La primera línea usa los 75; las siguientes gastan uno en el espacio inicial.
    const budget = chunks.length === 0 ? MAX_OCTETS_PER_LINE : MAX_OCTETS_PER_LINE - 1;
    let end = Math.min(start + budget, bytes.length);
    // 0b10xxxxxx es un byte de continuación UTF-8: retroceder hasta el inicio del carácter.
    while (end > start + 1 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    chunks.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return chunks.map((chunk, i) => (i === 0 ? chunk : ` ${chunk}`)).join(CRLF);
}

/**
 * Genera un archivo .ics (RFC 5545) a partir de tareas pendientes — para
 * importar al calendario del teléfono en vez de tener que mirar wacon o
 * Moodle. Puro: solo arma texto a partir de datos ya obtenidos.
 */
export function buildIcs(tasks, { now = Date.now(), eventMinutes = DEFAULT_EVENT_MINUTES, alarmMinutesBefore = DEFAULT_ALARM_MINUTES_BEFORE } = {}) {
  const stamp = toIcsUtc(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//dutic-wacon-bridge//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Entregas DUTIC",
  ];

  for (const task of tasks) {
    if (!task.dueDate) continue;
    const startMs = task.dueDate * 1000;

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:dutic-${task.cmid}@dutic-wacon-bridge`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${toIcsUtc(startMs)}`);
    // Un VEVENT sin DTEND ni DURATION es técnicamente de duración cero y varios
    // importadores (Google, Outlook) lo tratan de forma inconsistente. Una
    // entrega no "dura", así que se le da un bloque corto y visible.
    lines.push(`DTEND:${toIcsUtc(startMs + eventMinutes * 60_000)}`);
    lines.push(`SUMMARY:${escapeIcsText(`${task.courseName}: ${task.name}`)}`);
    if (task.description) lines.push(`DESCRIPTION:${escapeIcsText(task.description)}`);
    if (task.url) lines.push(`URL:${task.url}`);

    if (alarmMinutesBefore > 0) {
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(`TRIGGER:-PT${alarmMinutesBefore}M`);
      lines.push(`DESCRIPTION:${escapeIcsText(`Entrega: ${task.name}`)}`);
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF);
}
