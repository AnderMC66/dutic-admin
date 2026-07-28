import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { FileWriterPort } from "../../application/ports/FileWriterPort.mjs";

export class NodeFileWriterAdapter extends FileWriterPort {
  async write({ path, content }) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}
