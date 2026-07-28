#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { buildCompositionRoot } from "../../infrastructure/compositionRoot.mjs";
import { RunListenerCycle } from "../../application/use-cases/RunListenerCycle.mjs";
import { buildCommandHandlers, buildBriefText } from "../commands/commandHandlers.mjs";
import { ensureBridgeDir, LOG_PATH } from "../../infrastructure/paths.mjs";

const RETRY_BACKOFF_MS = 10_000;
const DAILY_BRIEF_HOUR = 7; // hora de Lima

function buildRunListenerCycle(deps) {
  return new RunListenerCycle({
    ...deps,
    commandHandlers: buildCommandHandlers(deps),
    dailyBrief: { hour: DAILY_BRIEF_HOUR, generate: () => buildBriefText(deps) },
  });
}

/**
 * Último recurso si algo revienta antes de que exista un logger (o el logger
 * mismo falla): escribe directo al archivo, para nunca perder la causa de
 * una caída silenciosa — Task Scheduler la reinicia, pero sin esto no
 * quedaría ningún rastro de por qué murió.
 */
function logCrash(label, err) {
  try {
    ensureBridgeDir();
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${label}: ${err?.stack ?? err}\n`);
  } catch {
    console.error(label, err);
  }
}

process.on("uncaughtException", (err) => {
  logCrash("uncaughtException", err);
  process.exit(1); // Task Scheduler (RestartCount) lo vuelve a levantar
});
process.on("unhandledRejection", (err) => {
  logCrash("unhandledRejection", err);
  process.exit(1);
});

/**
 * Proceso siempre-vivo (registrado como Tarea Programada). Dos trabajos:
 *  1. wacon marca un evento como "fired" y lo mete en un buffer interno,
 *     pero NUNCA manda el WhatsApp solo — hace falta alguien haciendo
 *     long-poll a wait_for_triggers que decida actuar. Sin este proceso,
 *     los recordatorios de 24h-antes de SyncAcademicTasks quedan
 *     disparados en el vacío.
 *  2. Escucha comandos que TÚ te escribes en el chat configurado ("!brief",
 *     "!sync", ...) y responde ahí mismo — ver ../commands/commandHandlers.mjs
 *     (compartido con la CLI nativa, interfaces/cli/dutic-wacon.mjs).
 */
async function main() {
  let deps = await buildCompositionRoot();
  deps.logger.log("=== reminder-listener iniciado ===");

  let useCase = buildRunListenerCycle(deps);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await useCase.runOnce();
    } catch (err) {
      deps.logger.log(`ERROR en el loop de recordatorios: ${err.stack ?? err.message}. Reintento en ${RETRY_BACKOFF_MS / 1000}s.`);
      // El daemon de wacon pudo haberse reiniciado (puerto/token nuevos en daemon.json):
      // se reconstruye todo en la próxima vuelta en vez de seguir usando datos viejos.
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
      try {
        deps = await buildCompositionRoot();
        useCase = buildRunListenerCycle(deps);
      } catch (reErr) {
        deps.logger?.log?.(`No se pudo reconstruir la conexión: ${reErr.message}`);
      }
    }
  }
}

main().catch((err) => logCrash("main() rechazado", err));
