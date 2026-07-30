import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CourseGroupMapPort } from "../../application/ports/CourseGroupMapPort.mjs";
import { ensureBridgeDir, BRIDGE_DIR } from "../paths.mjs";

export const COURSE_GROUP_MAP_PATH = join(BRIDGE_DIR, "course-groups.json");

const TEMPLATE = {
  _readme:
    'Mapea el courseId de dutic (dutic courses --json) al JID del grupo de WhatsApp del curso (wacon chats --json). Ejemplo: "2279": "120363012345678901@g.us". El comando `grupos` propone los pares y `mapear <courseId> <jid>` los escribe acá.',
};

/** Las claves que empiezan con "_" son documentación, no mapeos. */
function onlyMappings(raw) {
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("_")));
}

export class FileCourseGroupMap extends CourseGroupMapPort {
  constructor(logger) {
    super();
    this.logger = logger;
  }

  /** Lee el archivo entero, creándolo si no existe. Devuelve {} si está roto. */
  readAll() {
    if (!existsSync(COURSE_GROUP_MAP_PATH)) {
      ensureBridgeDir();
      writeFileSync(COURSE_GROUP_MAP_PATH, JSON.stringify(TEMPLATE, null, 2));
      return { ...TEMPLATE };
    }
    try {
      return JSON.parse(readFileSync(COURSE_GROUP_MAP_PATH, "utf8"));
    } catch (err) {
      // Archivo editado a mano y roto: se comporta como "sin mapeos", que los
      // casos de uso ya saben explicar, en vez de reventar la llamada.
      this.logger?.log(`course-groups.json ilegible (${err.message}); lo trato como vacío.`);
      return {};
    }
  }

  async getChatForCourse(courseId) {
    return this.readAll()[String(courseId)] ?? null;
  }

  async listMappings() {
    return onlyMappings(this.readAll());
  }

  async setChatForCourse(courseId, chatJid) {
    const current = this.readAll();
    current[String(courseId)] = chatJid;
    ensureBridgeDir();
    writeFileSync(COURSE_GROUP_MAP_PATH, JSON.stringify(current, null, 2));
    this.logger?.log(`Mapeo guardado: curso ${courseId} → ${chatJid}`);
  }
}
