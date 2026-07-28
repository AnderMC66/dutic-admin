/** Cursos matriculados (hoy: dutic-mcp) — para no tener que memorizar el courseId de cada uno. */
export class CoursesSourcePort {
  /** @returns {Promise<Array<{courseId:number, courseName:string, shortName:string}>>} */
  async listCourses() {
    throw new Error("not implemented");
  }
}
