import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { StateRepositoryPort } from "../../application/ports/StateRepositoryPort.mjs";
import { ensureBridgeDir, STATE_PATH, STATE_LOCK_PATH } from "../paths.mjs";
import { withFileLock } from "./fileLock.mjs";

const EMPTY_STATE = {
  tasks: {},
  flaggedConflicts: [],
  silentOverdueFlagged: [],
  gradeRisk: {},
  examMaterialsFetched: [],
  unknownStateFlagged: [],
  syncFailure: undefined,
  triggerListener: { msgCursor: undefined, triggerCursor: undefined },
  lastCommandTs: undefined,
  lastDailyBriefDate: undefined,
  lastDailyBriefAttemptTs: undefined,
};

/**
 * Snapshot que devolvió cada `load()`, para poder saber en `save()` qué claves
 * tocó de verdad el llamador. Va en un WeakMap y no dentro del estado para no
 * ensuciar el JSON que se persiste.
 */
const baselines = new WeakMap();

function readState() {
  if (!existsSync(STATE_PATH)) return structuredClone(EMPTY_STATE);
  try {
    return { ...structuredClone(EMPTY_STATE), ...JSON.parse(readFileSync(STATE_PATH, "utf8")) };
  } catch {
    return structuredClone(EMPTY_STATE);
  }
}

/**
 * Escribe a un temporal y renombra. `renameSync` reemplaza atómicamente (en
 * Windows también), así que un corte a mitad de escritura —el listener corre
 * indefinidamente y Task Scheduler lo mata sin aviso— nunca deja un state.json
 * truncado. Antes ese JSON roto se leía como estado vacío: se perdía el
 * tracking entero y la corrida siguiente re-creaba y re-anunciaba TODAS las
 * tareas pendientes.
 */
function writeAtomic(content) {
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, STATE_PATH);
}

function unchanged(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class FileStateRepository extends StateRepositoryPort {
  async load() {
    const state = readState();
    baselines.set(state, structuredClone(state));
    return state;
  }

  /**
   * Persiste solo las claves que el llamador modificó, re-leyendo el archivo
   * dentro del lock para no pisar lo que otro proceso escribió mientras este
   * caso de uso corría (un sync tarda minutos; el listener guarda cada 20 s).
   *
   * Los casos de uso son dueños de claves disjuntas — `tasks`/`flaggedConflicts`/
   * `silentOverdueFlagged` del sync, `gradeRisk` del riesgo de notas,
   * `examMaterialsFetched` del prefetch, `triggerListener`/`lastCommandTs`/
   * `lastDailyBriefDate` del listener — así que fusionar por clave alcanza para
   * que ninguno pierda el trabajo del otro, sin tener que restructurarlos para
   * que sostengan un lock durante minutos.
   */
  async save(state) {
    ensureBridgeDir();
    const baseline = baselines.get(state) ?? structuredClone(EMPTY_STATE);

    await withFileLock(STATE_LOCK_PATH, () => {
      const fresh = readState();
      const merged = {};
      for (const key of new Set([...Object.keys(fresh), ...Object.keys(state)])) {
        const touchedByCaller = !unchanged(state[key], baseline[key]);
        merged[key] = touchedByCaller ? state[key] : fresh[key];
      }
      writeAtomic(JSON.stringify(merged, null, 2));
    });

    // Lo que este llamador acaba de escribir pasa a ser su nueva línea base: si
    // vuelve a guardar sin tocar una clave, gana lo que haya en disco.
    baselines.set(state, structuredClone(state));
  }
}
