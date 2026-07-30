import { DocumentReaderPort } from "../../application/ports/DocumentReaderPort.mjs";
import { execDutic } from "./execDutic.mjs";

const DEFAULT_MAX_CHARS = 20_000;

/** `dutic md <pdf>` convierte un PDF local a Markdown; si no se puede, no es un error fatal. */
export class DuticCliDocumentReader extends DocumentReaderPort {
  async toMarkdown({ path, maxChars = DEFAULT_MAX_CHARS }) {
    try {
      const out = await execDutic(["md", path, "--max", String(maxChars)], { timeout: 2 * 60_000, maxBuffer: 16 * 1024 * 1024 });
      const text = out.trim();
      return text || null;
    } catch {
      return null; // un PDF escaneado o protegido no puede tumbar el sync
    }
  }
}
