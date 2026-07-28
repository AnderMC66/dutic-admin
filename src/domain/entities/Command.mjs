/**
 * Comandos que escribes en tu propio chat de WhatsApp ("Mensajes para mí").
 * El prefijo "!" es intencional: ningún mensaje que el bridge genera empieza
 * así (usan emojis: 📚 🆕 ⏰ ⚠️), así que no hay riesgo de que el bot
 * reaccione a sus propios avisos como si fueran comandos tuyos.
 */
const PREFIX = "!";

export function parseCommand(text) {
  const trimmed = text?.trim();
  if (!trimmed?.startsWith(PREFIX)) return null;
  const [rawName, ...args] = trimmed.slice(PREFIX.length).split(/\s+/).filter(Boolean);
  if (!rawName) return null;
  return { name: rawName.toLowerCase(), args };
}
