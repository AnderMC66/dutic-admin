import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CourseGroupMapPort } from "../../application/ports/CourseGroupMapPort.mjs";
import { ensureBridgeDir, BRIDGE_DIR } from "../paths.mjs";

export const COURSE_GROUP_MAP_PATH = join(BRIDGE_DIR, "course-groups.json");

const TEMPLATE = {
  _readme: "Mapea el courseId de dutic (dutic courses --json) al JID del grupo de WhatsApp del curso (wacon chats --json). Ejemplo: \"2279\": \"120363012345678901@g.us\"",
};

export class FileCourseGroupMap extends CourseGroupMapPort {
  constructor(logger) {
    super();
    this.logger = logger;
  }

  async getChatForCourse(courseId) {
    if (!existsSync(COURSE_GROUP_MAP_PATH)) {
      ensureBridgeDir();
      writeFileSync(COURSE_GROUP_MAP_PATH, JSON.stringify(TEMPLATE, null, 2));
      return null;
    }
    try {
      const map = JSON.parse(readFileSync(COURSE_GROUP_MAP_PATH, "utf8"));
      return map[String(courseId)] ?? null;
    } catch (err) {
      // Archivo editado a mano y roto: se comporta como "curso no mapeado", que
      // los casos de uso ya saben explicar, en vez de reventar la llamada.
      this.logger?.log(`course-groups.json ilegible (${err.message}); trato el curso ${courseId} como no mapeado.`);
      return null;
    }
  }
}
