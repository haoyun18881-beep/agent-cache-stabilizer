import fs from "node:fs";
import path from "node:path";

export class StatePersister {
  constructor(config, logger) {
    this.enabled = Boolean(config.state?.enabled);
    this.file = config.state?.file || "";
    this.logger = logger;
  }

  load() {
    if (!this.enabled || !this.file || !fs.existsSync(this.file)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.logger?.info(`[ACS] loaded state from ${this.file}`);
      return data?.waterline || data;
    } catch (error) {
      this.logger?.warn(`[ACS] state load failed: ${error.message}`);
      return null;
    }
  }

  save(waterlineState) {
    if (!this.enabled || !this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tempFile = `${this.file}.tmp`;
      fs.writeFileSync(
        tempFile,
        JSON.stringify({ savedAt: Date.now(), waterline: waterlineState }, null, 2),
        "utf8"
      );
      fs.renameSync(tempFile, this.file);
    } catch (error) {
      this.logger?.warn(`[ACS] state save failed: ${error.message}`);
    }
  }

  clear() {
    if (!this.enabled || !this.file || !fs.existsSync(this.file)) return;
    try {
      fs.rmSync(this.file);
    } catch (error) {
      this.logger?.warn(`[ACS] state clear failed: ${error.message}`);
    }
  }
}
