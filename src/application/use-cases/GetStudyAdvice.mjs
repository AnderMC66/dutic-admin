/**
 * Consejo de estudio para un curso, citando material real: resuelve el
 * grupo de WhatsApp del curso (mismo mapeo que CrossReferenceClassmates) y
 * le pide a wacon que consulte el NotebookLM etiquetado para ese chat.
 * Requiere que el usuario haya etiquetado el grupo (`wacon tag <chat> <tag>`)
 * y mapeado tag→notebook en ~/.wacon/notebooks.json — si no, wacon mismo
 * degrada con una nota explicando qué falta, en vez de romper.
 */
export class GetStudyAdvice {
  constructor({ courseGroupMap, playbook, logger }) {
    this.courseGroupMap = courseGroupMap;
    this.playbook = playbook;
    this.logger = logger;
  }

  async run(courseId, topic) {
    const chatJid = await this.courseGroupMap.getChatForCourse(courseId);
    if (!chatJid) {
      return {
        advised: false,
        message: `No hay grupo de WhatsApp mapeado para el curso ${courseId}. Agrégalo en ~/.dutic-wacon-bridge/course-groups.json.`,
      };
    }

    const result = await this.playbook.consult({ chatJid, situation: topic });
    this.logger.log(`Consulta de playbook para curso ${courseId}: consulted=${result?.consulted}, degraded=${result?.degraded}`);
    return { advised: true, chatJid, ...result };
  }
}
