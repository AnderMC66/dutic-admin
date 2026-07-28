#!/usr/bin/env node
import { buildCompositionRoot } from "../../infrastructure/compositionRoot.mjs";
import { SyncAcademicTasks } from "../../application/use-cases/SyncAcademicTasks.mjs";

/**
 * Entrypoint del cron: arma la composición compartida y corre una
 * sincronización. Cambiar de proveedor académico o de canal de aviso
 * significa tocar compositionRoot.mjs — el dominio y el caso de uso no se
 * tocan.
 */
async function main() {
  const deps = await buildCompositionRoot();
  deps.logger.log("=== sync start ===");

  try {
    await new SyncAcademicTasks(deps).run();
  } catch (err) {
    deps.logger.log(`ERROR fatal: ${err.stack ?? err.message}`);
    process.exitCode = 1;
  }
  deps.logger.log("=== sync end ===");
}

main();
