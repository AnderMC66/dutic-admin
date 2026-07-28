import { matchRosterToGroup } from "../../domain/services/NameMatcher.mjs";

/**
 * Compara el roster oficial de un curso (DUTIC) contra los miembros del
 * grupo de WhatsApp de ese curso (wacon) — para saber quién de tu grupo es
 * realmente compañero de curso (y a quién le puedes pedir ayuda con
 * confianza), y quién del curso no está en el grupo.
 */
export class CrossReferenceClassmates {
  constructor({ courseGroupMap, people, groupMembers, logger }) {
    this.courseGroupMap = courseGroupMap;
    this.people = people;
    this.groupMembers = groupMembers;
    this.logger = logger;
  }

  async run(courseId) {
    const chatJid = await this.courseGroupMap.getChatForCourse(courseId);
    if (!chatJid) {
      return {
        mapped: false,
        message: `No hay grupo de WhatsApp mapeado para el curso ${courseId}. Agrégalo en ~/.dutic-wacon-bridge/course-groups.json (usa 'wacon chats' para ver los JID disponibles).`,
      };
    }

    const [roster, group] = await Promise.all([this.people.listCourseParticipants(courseId), this.groupMembers.listGroupMembers(chatJid)]);
    const { matched, onlyInRoster, onlyInGroup } = matchRosterToGroup(roster, group.members);

    this.logger.log(
      `Cruce curso ${courseId} vs. grupo "${group.groupName ?? chatJid}": ${matched.length} coinciden, ` +
        `${onlyInRoster.length} solo en roster, ${onlyInGroup.length} solo en el grupo.`,
    );

    return { mapped: true, chatJid, groupName: group.groupName, matched, onlyInRoster, onlyInGroup };
  }
}
