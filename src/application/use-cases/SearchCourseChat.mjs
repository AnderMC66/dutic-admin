/**
 * Busca en el historial del grupo de un curso. El digest sólo cubre las últimas
 * horas; esto llega a "¿qué dijo el profe del formato del TIF?" aunque haya
 * sido hace tres semanas.
 */
export class SearchCourseChat {
  constructor({ courseGroupMap, messageSearch, logger }) {
    this.courseGroupMap = courseGroupMap;
    this.messageSearch = messageSearch;
    this.logger = logger;
  }

  async run(courseId, query, limit = 10) {
    const chatJid = await this.courseGroupMap.getChatForCourse(courseId);
    if (!chatJid) {
      return {
        searched: false,
        message: `No hay grupo de WhatsApp mapeado para el curso ${courseId}. Usá 'grupos' para ver cuáles faltan.`,
      };
    }

    const hits = await this.messageSearch.search({ query, chatJid, limit });
    this.logger?.log(`Búsqueda "${query}" en el curso ${courseId}: ${hits.length} resultado(s).`);
    return { searched: true, chatJid, query, hits };
  }
}
