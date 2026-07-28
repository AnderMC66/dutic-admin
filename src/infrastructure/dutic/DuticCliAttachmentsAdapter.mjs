import { AttachmentsPort } from "../../application/ports/AttachmentsPort.mjs";
import { execDutic } from "./execDutic.mjs";

export class DuticCliAttachmentsAdapter extends AttachmentsPort {
  async downloadAttachment({ url, dest }) {
    try {
      execDutic(["download", url, dest], { timeout: 2 * 60_000, maxBuffer: 8 * 1024 * 1024 });
      return { path: dest };
    } catch {
      return null; // adjunto opcional: si falla, se avisa sin él en vez de romper el resto
    }
  }
}
