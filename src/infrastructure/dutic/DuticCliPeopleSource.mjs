import { PeopleSourcePort } from "../../application/ports/PeopleSourcePort.mjs";
import { execDutic } from "./execDutic.mjs";

export class DuticCliPeopleSource extends PeopleSourcePort {
  async listCourseParticipants(courseId) {
    const raw = await execDutic(["people", String(courseId), "--json"], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(raw);
  }
}
