/** Notas oficiales por curso (hoy: scraping de Moodle vía dutic-mcp). */
export class GradesSourcePort {
  /** @returns {Promise<Array<{courseId:number, courseName:string, total:string|null}>>} */
  async listAllCourseGrades() {
    throw new Error("not implemented");
  }
}
