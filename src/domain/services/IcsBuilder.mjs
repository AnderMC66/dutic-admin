/** Escapa texto para un campo iCalendar (RFC 5545 §3.3.11). */
function escapeIcsText(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function toIcsUtc(epochMs) {
  return new Date(epochMs).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

/**
 * Genera un archivo .ics (RFC 5545) a partir de tareas pendientes — para
 * importar al calendario del teléfono en vez de tener que mirar wacon o
 * Moodle. Puro: solo arma texto a partir de datos ya obtenidos.
 */
export function buildIcs(tasks, { now = Date.now() } = {}) {
  const stamp = toIcsUtc(now);
  const events = tasks
    .filter((t) => t.dueDate)
    .map((t) => {
      const start = toIcsUtc(t.dueDate * 1000);
      const summary = escapeIcsText(`${t.courseName}: ${t.name}`);
      const lines = [
        "BEGIN:VEVENT",
        `UID:dutic-${t.cmid}@dutic-wacon-bridge`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${start}`,
        `SUMMARY:${summary}`,
      ];
      if (t.description) lines.push(`DESCRIPTION:${escapeIcsText(t.description)}`);
      if (t.url) lines.push(`URL:${t.url}`);
      lines.push("END:VEVENT");
      return lines.join("\r\n");
    });

  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//dutic-wacon-bridge//ES", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR"].join(
    "\r\n",
  );
}
