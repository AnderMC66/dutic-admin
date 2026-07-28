import { SisacadSourcePort } from "../../application/ports/SisacadSourcePort.mjs";
import { execDutic } from "./execDutic.mjs";

export class DuticCliSisacadSource extends SisacadSourcePort {
  async loadCaptured() {
    let raw;
    try {
      raw = execDutic(["sisacad", "show", "--json"], { timeout: 30_000 });
    } catch {
      return null; // sin sesión/captura previa: no es un error, solo no hay dato aún
    }
    try {
      const parsed = JSON.parse(raw);
      return parsed?.courses?.length ? parsed : null;
    } catch {
      return null;
    }
  }
}
