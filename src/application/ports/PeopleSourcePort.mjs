/** Roster oficial de un curso (hoy: dutic-mcp). */
export class PeopleSourcePort {
  /** @param {number} courseId @returns {Promise<Array<{name:string, email?:string, role?:string}>>} */
  async listCourseParticipants(courseId) {
    throw new Error("not implemented");
  }
}
