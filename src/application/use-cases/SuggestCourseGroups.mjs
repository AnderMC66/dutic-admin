import { findBestCourseMatch, courseSimilarity } from "../../domain/services/CourseMatcher.mjs";

/**
 * Dice qué cursos ya tienen su grupo de WhatsApp mapeado, cuáles no, y propone
 * candidatos para los que faltan.
 *
 * Existe porque el mapeo es manual y el bridge nunca avisaba cuáles faltaban:
 * las tres funciones que dependen de él (digest, compañeros, asesor de estudio)
 * simplemente no hacían nada para esos cursos, sin decir por qué.
 *
 * No escribe nada solo: proponer un grupo es adivinar por nombre, y un mapeo
 * equivocado te mostraría el chat de otro curso. La confirmación es del usuario
 * (`mapear <courseId> <jid>`).
 */
export class SuggestCourseGroups {
  constructor({ coursesSource, chatDirectory, courseGroupMap, logger }) {
    this.coursesSource = coursesSource;
    this.chatDirectory = chatDirectory;
    this.courseGroupMap = courseGroupMap;
    this.logger = logger;
  }

  async run() {
    const [courses, chats, mappings] = await Promise.all([
      this.coursesSource.listCourses(),
      this.chatDirectory.listChats(),
      this.courseGroupMap.listMappings(),
    ]);

    const groups = chats.filter((c) => c.isGroup && c.name);
    const jidToName = new Map(groups.map((g) => [g.jid, g.name]));
    // Un grupo ya asignado a un curso no puede proponerse para otro.
    const takenJids = new Set(Object.values(mappings));

    const mapped = [];
    const unmapped = [];

    for (const course of courses) {
      const jid = mappings[String(course.courseId)];
      if (jid) {
        mapped.push({ ...course, chatJid: jid, groupName: jidToName.get(jid) ?? null });
        continue;
      }
      const candidates = groups.filter((g) => !takenJids.has(g.jid));
      const best = findBestCourseMatch(course.courseName, candidates, (g) => g.name);
      unmapped.push({
        ...course,
        suggestion: best ? { jid: best.jid, name: best.name, score: Number(courseSimilarity(course.courseName, best.name).toFixed(2)) } : null,
      });
    }

    this.logger?.log(`Mapeo curso→grupo: ${mapped.length} mapeado(s), ${unmapped.length} sin mapear.`);
    return { mapped, unmapped, groupCount: groups.length };
  }
}

/** Escribe un mapeo confirmado por el usuario. */
export class MapCourseGroup {
  constructor({ courseGroupMap, chatDirectory, logger }) {
    this.courseGroupMap = courseGroupMap;
    this.chatDirectory = chatDirectory;
    this.logger = logger;
  }

  async run(courseId, chatJid) {
    if (!/@g\.us$/.test(chatJid)) {
      return { mapped: false, message: `"${chatJid}" no parece un JID de grupo (tienen que terminar en @g.us).` };
    }
    const chats = await this.chatDirectory.listChats().catch(() => []);
    const known = chats.find((c) => c.jid === chatJid);

    await this.courseGroupMap.setChatForCourse(courseId, chatJid);
    return { mapped: true, courseId, chatJid, groupName: known?.name ?? null, warning: known ? null : "ese JID no aparece entre tus chats" };
  }
}
