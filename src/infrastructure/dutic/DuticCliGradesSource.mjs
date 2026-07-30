import { GradesSourcePort } from "../../application/ports/GradesSourcePort.mjs";
import { execDutic } from "./execDutic.mjs";

export class DuticCliGradesSource extends GradesSourcePort {
  async listAllCourseGrades() {
    const raw = await execDutic(["grades", "--json"], { timeout: 3 * 60_000, maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(raw); // CourseGrades[]
  }
}
