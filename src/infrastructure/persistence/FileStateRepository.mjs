import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { StateRepositoryPort } from "../../application/ports/StateRepositoryPort.mjs";
import { ensureBridgeDir, STATE_PATH } from "../paths.mjs";

const EMPTY_STATE = {
  tasks: {},
  flaggedConflicts: [],
  silentOverdueFlagged: [],
  gradeRisk: {},
  examMaterialsFetched: [],
  triggerListener: { msgCursor: undefined, triggerCursor: undefined },
  lastCommandTs: undefined,
  lastDailyBriefDate: undefined,
};

export class FileStateRepository extends StateRepositoryPort {
  async load() {
    if (!existsSync(STATE_PATH)) return structuredClone(EMPTY_STATE);
    try {
      const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8"));
      return { ...structuredClone(EMPTY_STATE), ...parsed };
    } catch {
      return structuredClone(EMPTY_STATE);
    }
  }

  async save(state) {
    ensureBridgeDir();
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }
}
