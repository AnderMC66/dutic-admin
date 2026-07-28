export class GetCourseTeachers {
  constructor({ teachersSource, logger }) {
    this.teachersSource = teachersSource;
    this.logger = logger;
  }

  async run(courseId) {
    const teachers = await this.teachersSource.listCourseTeachers(courseId);
    this.logger.log(`Docentes curso ${courseId}: ${teachers.length}.`);
    return { courseId, teachers };
  }
}
