import { CoursesSourcePort } from "../../application/ports/CoursesSourcePort.mjs";
import { execDutic } from "./execDutic.mjs";

export class DuticCliCoursesAdapter extends CoursesSourcePort {
  async listCourses() {
    const raw = execDutic(["courses", "--json"], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const courses = JSON.parse(raw);
    return courses.map((c) => ({ courseId: c.id, courseName: c.fullname, shortName: c.shortname }));
  }
}
