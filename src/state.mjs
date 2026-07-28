import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ensureBridgeDir, STATE_PATH } from "./paths.mjs";

/**
 * Estado por tarea (keyed by dutic cmid):
 * { title, courseName, dueDate, submission, dateConflict,
 *   waconTaskId, waconEventId }
 * Y un registro aparte de pares conflicto-ya-avisado: `flaggedConflicts: string[]`.
 */
const EMPTY_STATE = { tasks: {}, flaggedConflicts: [] };

export function loadState() {
  if (!existsSync(STATE_PATH)) return structuredClone(EMPTY_STATE);
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    return { ...structuredClone(EMPTY_STATE), ...parsed };
  } catch {
    return structuredClone(EMPTY_STATE);
  }
}

export function saveState(state) {
  ensureBridgeDir();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}
