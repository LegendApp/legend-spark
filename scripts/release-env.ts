import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export function loadReleaseEnv(root: string) {
  const file = path.join(root, ".env");
  if (existsSync(file)) {
    for (const [name, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) process.env[name] ??= value;
  }
}
