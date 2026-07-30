/**
 * Mapeo curso DUTIC -> grupo de WhatsApp. No se auto-detecta (los nombres de
 * grupo casi nunca calzan con el nombre oficial del curso, y adivinar mal
 * sería peor que no mapear); lo llena el usuario una vez a mano.
 */
export class CourseGroupMapPort {
  /** @returns {Promise<Record<string,string>>} courseId → JID, sin las claves de documentación. */
  async listMappings() {
    throw new Error("not implemented");
  }

  /** @param {number|string} courseId @param {string} chatJid */
  async setChatForCourse(courseId, chatJid) {
    throw new Error("not implemented");
  }

  /** @param {number} courseId @returns {Promise<string|null>} */
  async getChatForCourse(courseId) {
    throw new Error("not implemented");
  }
}
