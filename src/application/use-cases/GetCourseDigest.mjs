const DEFAULT_SINCE_MINUTES = 1440; // 24h

/**
 * Resumen comprimido de lo que se habló en el grupo de WhatsApp de un
 * curso, sin leer el chat entero. wacon.digest() es global (todos los
 * chats); acá se resuelve el grupo del curso (mismo mapeo que
 * CrossReferenceClassmates) y se filtra su entrada.
 */
export class GetCourseDigest {
  constructor({ courseGroupMap, digest, logger }) {
    this.courseGroupMap = courseGroupMap;
    this.digest = digest;
    this.logger = logger;
  }

  async run(courseId, sinceMinutes = DEFAULT_SINCE_MINUTES) {
    const chatJid = await this.courseGroupMap.getChatForCourse(courseId);
    if (!chatJid) {
      return {
        mapped: false,
        message: `No hay grupo de WhatsApp mapeado para el curso ${courseId}. Agrégalo en ~/.dutic-wacon-bridge/course-groups.json.`,
      };
    }

    const result = await this.digest.getDigest(sinceMinutes);
    const entry = result.chats.find((c) => c.chat === chatJid);
    this.logger.log(`Digest curso ${courseId}: ${entry ? `${entry.incoming} mensajes` : "sin actividad"} desde ${result.since}.`);

    return {
      mapped: true,
      chatJid,
      since: result.since,
      activity: entry ?? { chat: chatJid, incoming: 0, preview: null, lastAt: null },
    };
  }
}
