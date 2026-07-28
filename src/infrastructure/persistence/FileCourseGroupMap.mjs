import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CourseGroupMapPort } from "../../application/ports/CourseGroupMapPort.mjs";
import { ensureBridgeDir, BRIDGE_DIR } from "../paths.mjs";

export const COURSE_GROUP_MAP_PATH = join(BRIDGE_DIR, "course-groups.json");

const TEMPLATE = {
  _readme: "Mapea el courseId de dutic (dutic courses --json) al JID del grupo de WhatsApp del curso (wacon chats --json). Ejemplo: \"2279\": \"120363012345678901@g.us\"",
};

export class FileCourseGroupMap extends CourseGroupMapPort {
  async getChatForCourse(courseId) {
    if (!existsSync(COURSE_GROUP_MAP_PATH)) {
      ensureBridgeDir();
      writeFileSync(COURSE_GROUP_MAP_PATH, JSON.stringify(TEMPLATE, null, 2));
      return null;
    }
    const map = JSON.parse(readFileSync(COURSE_GROUP_MAP_PATH, "utf8"));
    return map[String(courseId)] ?? null;
  }
}
