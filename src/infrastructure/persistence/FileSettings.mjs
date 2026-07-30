import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ensureBridgeDir, BRIDGE_DIR } from "../paths.mjs";

export const CONFIG_PATH = join(BRIDGE_DIR, "config.json");

/**
 * Valores que antes vivían como constantes repartidas por el código. Cambiar
 * cualquiera obligaba a editar fuentes y reiniciar el listener; ahora salen de
 * config.json, con estos defaults si el archivo no los trae.
 */
export const DEFAULT_SETTINGS = {
  commandChatJid: null,
  dailyBriefHour: 7,
  reminderMinutesBefore: 24 * 60,
  conflictThresholdHours: 20,
  examDaysBefore: 3,
  passingPercentage: 52.5,
  sourceCacheSeconds: 60,
  failureNotifyCooldownHours: 24,
};

const README_LINES = {
  _readme:
    "commandChatJid: a qué chat van los avisos y de dónde se leen los comandos ('!brief', etc). " +
    "Vacío = tu propio chat ('Mensajes para mí'), pero ese chat NO sincroniza mensajes escritos desde " +
    "el teléfono hacia una sesión vinculada (limitación de WhatsApp/Baileys) — si querés usar comandos " +
    "desde tu celular, poné acá el JID de un grupo donde seas el único miembro (ver 'wacon chats --json').",
  _readme_ajustes:
    "dailyBriefHour: hora de Lima a la que se manda solo el brief del día. " +
    "reminderMinutesBefore: cuánto antes del vencimiento avisa el recordatorio. " +
    "conflictThresholdHours: diferencia mínima entre la fecha de Moodle y la del grupo para marcar conflicto. " +
    "examDaysBefore: ventana de '!examen' sin argumento. " +
    "passingPercentage: mínimo aprobatorio en % (52.5 = 10.5/20 en la UNSA). " +
    "sourceCacheSeconds: cuánto se reusa una lectura de tareas/notas antes de volver a preguntarle a dutic. " +
    "failureNotifyCooldownHours: cada cuánto repetir el aviso si el sync sigue fallando por lo mismo.",
};

/** Valida y acota un número de config; si no sirve, se usa el default sin romper nada. */
function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function hourOfDay(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
}

/**
 * Lee config.json una vez por proceso. A diferencia del chat de destino —que se
 * relee en cada notify para poder cambiarlo sin reiniciar— estos valores se
 * consumen al armar los casos de uso, así que releerlos no cambiaría nada hasta
 * el próximo arranque de todos modos.
 */
export function loadSettings(logger) {
  if (!existsSync(CONFIG_PATH)) {
    ensureBridgeDir();
    writeFileSync(CONFIG_PATH, JSON.stringify({ ...README_LINES, ...DEFAULT_SETTINGS }, null, 2));
    return { ...DEFAULT_SETTINGS };
  }

  let raw = {};
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (err) {
    logger?.log(`config.json ilegible (${err.message}); uso los valores por defecto.`);
    return { ...DEFAULT_SETTINGS };
  }

  // Un config.json de una versión anterior no conoce los ajustes nuevos: se le
  // agregan con su default y su documentación, sin tocar nada de lo que ya
  // tenga. Si no, los tunables existirían pero nadie se enteraría de que están.
  const faltantes = Object.keys({ ...README_LINES, ...DEFAULT_SETTINGS }).filter((k) => !(k in raw));
  if (faltantes.length) {
    try {
      writeFileSync(CONFIG_PATH, JSON.stringify({ ...README_LINES, ...DEFAULT_SETTINGS, ...raw }, null, 2));
      logger?.log(`config.json: se agregaron ${faltantes.length} ajuste(s) nuevo(s) con su valor por defecto.`);
    } catch (err) {
      logger?.log(`no se pudo actualizar config.json (${err.message}); sigo con los valores en memoria.`);
    }
  }

  return {
    commandChatJid: raw.commandChatJid ?? DEFAULT_SETTINGS.commandChatJid,
    dailyBriefHour: hourOfDay(raw.dailyBriefHour, DEFAULT_SETTINGS.dailyBriefHour),
    reminderMinutesBefore: positiveNumber(raw.reminderMinutesBefore, DEFAULT_SETTINGS.reminderMinutesBefore),
    conflictThresholdHours: positiveNumber(raw.conflictThresholdHours, DEFAULT_SETTINGS.conflictThresholdHours),
    examDaysBefore: positiveNumber(raw.examDaysBefore, DEFAULT_SETTINGS.examDaysBefore),
    passingPercentage: positiveNumber(raw.passingPercentage, DEFAULT_SETTINGS.passingPercentage),
    sourceCacheSeconds: positiveNumber(raw.sourceCacheSeconds, DEFAULT_SETTINGS.sourceCacheSeconds),
    failureNotifyCooldownHours: positiveNumber(raw.failureNotifyCooldownHours, DEFAULT_SETTINGS.failureNotifyCooldownHours),
  };
}
