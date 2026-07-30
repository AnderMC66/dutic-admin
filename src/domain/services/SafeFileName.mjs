/**
 * Un nombre de adjunto viene de Moodle, o sea de fuera: nadie garantiza que sea
 * un nombre de archivo sano. Antes se usaba tal cual para armar el path de
 * destino y para pasárselo al CLI, así que un "..\\..\\algo.txt" escribía fuera
 * del directorio del bridge y un nombre con comillas podía cortar la línea de
 * comandos. Acá se reduce a un nombre plano y seguro.
 *
 * Puro: solo transforma texto, sin tocar disco — por eso vive en domain/.
 */

const FALLBACK = "adjunto";
const MAX_LENGTH = 120;

// Nombres de dispositivo reservados en Windows: un archivo llamado "CON" o
// "NUL" no se puede crear, y escribirle manda los datos al dispositivo.
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Extensión (con el punto) de un nombre ya saneado, o "" si no tiene. */
function splitExtension(name) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return { base: name, ext: "" };
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}

export function safeFileName(rawName) {
  // Solo la última parte: corta cualquier intento de path (los dos separadores,
  // porque el nombre puede venir con los de otro sistema operativo).
  const lastSegment = String(rawName ?? "")
    .split(/[/\\]/)
    .pop();

  const cleaned = lastSegment
    .normalize("NFC")
    // Todo lo que no sea alfanumérico, punto, guion, guion bajo, paréntesis o
    // espacio pasa a "_": deja fuera comillas, %, & y los separadores de path.
    .replace(/[^\p{L}\p{N}._\-() ]/gu, "_")
    .replace(/\s+/g, " ")
    // Un nombre que arranca con puntos ("..", ".git") no aporta y es el vector
    // clásico de path traversal.
    .replace(/^\.+/, "")
    .trim();

  if (!cleaned) return FALLBACK;

  const { base, ext } = splitExtension(cleaned);
  const safeBase = RESERVED_WINDOWS_NAMES.test(base) ? `${base}_` : base;
  const truncatedBase = safeBase.slice(0, Math.max(1, MAX_LENGTH - ext.length));

  return `${truncatedBase}${ext}`;
}
