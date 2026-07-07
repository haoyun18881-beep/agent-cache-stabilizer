import fs from "node:fs";

export function ensureRuntimeDirs(config) {
  for (const dir of [config.runtime?.logDir, config.runtime?.stateDir]) {
    if (dir) fs.mkdirSync(dir, { recursive: true });
  }
}
