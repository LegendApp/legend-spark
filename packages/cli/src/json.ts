import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";

export function readJson(file: string): any {
  return JSON.parse(readFileSync(file, "utf8"));
}
export function writeJson(file: string, value: unknown) {
  const content = JSON.stringify(value, null, 2) + "\n";
  // Metro watches JSON too: rewriting unchanged session state on every runtime
  // check causes empty Fast Refresh updates even when app code has not changed.
  if (existsSync(file) && readFileSync(file, "utf8") === content) return;
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, file);
}
