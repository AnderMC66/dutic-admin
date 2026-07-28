/**
 * Mapeo curso DUTIC -> grupo de WhatsApp. No se auto-detecta (los nombres de
 * grupo casi nunca calzan con el nombre oficial del curso, y adivinar mal
 * sería peor que no mapear); lo llena el usuario una vez a mano.
 */
export class CourseGroupMapPort {
  /** @param {number} courseId @returns {Promise<string|null>} */
  async getChatForCourse(courseId) {
    throw new Error("not implemented");
  }
}
