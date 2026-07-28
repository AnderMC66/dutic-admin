#!/usr/bin/env node
import { buildCompositionRoot } from "../../infrastructure/compositionRoot.mjs";
import { buildCommandHandlers } from "../commands/commandHandlers.mjs";
import { runMenu } from "./menu.mjs";

const HELP = [
  "duticbat                       panel interactivo (elegís de una lista, te pregunta los datos)",
  "duticbat <comando> [args]      corre un comando directo, para scripts o uso rápido",
  "",
  "Comandos:",
  "  brief                          qué tengo pendiente (académico + WhatsApp)",
  "  sync                           forzar sincronización DUTIC → wacon",
  "  riesgo                         riesgo de reprobar por curso",
  "  docentes <courseId>            docentes de un curso",
  "  digest <courseId>              resumen del grupo de WhatsApp del curso",
  "  companeros <courseId>          roster oficial vs. grupo de WhatsApp",
  '  estudio <courseId> <tema...>   consejo de estudio (NotebookLM)',
  "  material <courseId>            descargar todo el material del curso",
  "  examen [dias]                  preparar material de exámenes próximos (default 3 días)",
  "  calendario                     .ics con tus entregas, mandado por WhatsApp",
  "  cursos                         tus cursos con su courseId (para los comandos que lo piden)",
  "  ayuda                          este mensaje",
  "",
  "Mismos casos de uso que el servidor MCP (dutic-wacon-bridge) y los comandos de WhatsApp",
  "('!brief', '!sync', ...) — solo cambia la puerta de entrada. sync/material/examen/",
  "calendario también mandan su aviso normal por WhatsApp, no solo imprimen acá.",
].join("\n");

/**
 * CLI nativa ("duticbat"), para correr comandos desde la terminal en vez de
 * por WhatsApp o desde un agente MCP — misma composición, mismos casos de
 * uso (../commands/commandHandlers.mjs), otra puerta de entrada.
 */
async function main() {
  const [commandName, ...args] = process.argv.slice(2);

  if (["-h", "--help", "help"].includes(commandName)) {
    console.log(HELP);
    return;
  }

  const deps = await buildCompositionRoot();
  const handlers = buildCommandHandlers(deps);

  // Sin comando y en una terminal real (no un script/pipe): panel interactivo.
  if (!commandName) {
    if (process.stdin.isTTY) {
      await runMenu(handlers, deps);
    } else {
      console.log(HELP);
    }
    return;
  }

  const handler = handlers[commandName];
  if (!handler) {
    console.error(`Comando desconocido: "${commandName}"\n`);
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  try {
    console.log(await handler(args));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// Sin process.exit() forzado a propósito: en Windows, forzar la salida
// mientras todavía hay handles internos (fetch/child_process) cerrándose
// dispara un assertion failure de libuv. Dejamos que Node drene el event
// loop solo y salga con process.exitCode ya seteado.
main().catch((err) => {
  console.error(`Error fatal: ${err.stack ?? err.message}`);
  process.exitCode = 1;
});
