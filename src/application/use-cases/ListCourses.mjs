/** Lista tus cursos matriculados con su courseId — para no tener que memorizarlos ni buscarlos aparte. */
export class ListCourses {
  constructor({ coursesSource, logger }) {
    this.coursesSource = coursesSource;
    this.logger = logger;
  }

  async run() {
    const courses = await this.coursesSource.listCourses();
    this.logger.log(`Cursos matriculados: ${courses.length}.`);
    return { courses };
  }
}
