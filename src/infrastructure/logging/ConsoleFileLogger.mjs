import { appendFileSync, statSync, renameSync } from "node:fs";
import { LoggerPort } from "../../application/ports/LoggerPort.mjs";
import { ensureBridgeDir, LOG_PATH } from "../paths.mjs";

// El listener corre por semanas y loguea cada ciclo: sin techo, sync.log crece
// para siempre. Se conserva una sola generación anterior.
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const PREVIOUS_LOG_PATH = `${LOG_PATH}.1`;

export class ConsoleFileLogger extends LoggerPort {
  constructor() {
    super();
    // Una vez por proceso, no una vez por línea (antes era un existsSync por log).
    ensureBridgeDir();
  }

  log(line) {
    const stamped = `[${new Date().toISOString()}] ${line}`;
    console.log(stamped);
    try {
      this.rotateIfNeeded();
      appendFileSync(LOG_PATH, stamped + "\n");
    } catch (err) {
      // Un problema de disco no puede tumbar el proceso justo cuando está
      // intentando dejar registro de algo.
      console.error(`(no se pudo escribir en ${LOG_PATH}: ${err.message})`);
    }
  }

  rotateIfNeeded() {
    let size;
    try {
      size = statSync(LOG_PATH).size;
    } catch {
      return; // todavía no existe: nada que rotar
    }
    if (size < MAX_LOG_BYTES) return;
    renameSync(LOG_PATH, PREVIOUS_LOG_PATH); // reemplaza la generación anterior
  }
}
