// The golden store: e2e/golden/<platform>/<appearance>/<locale>/<name>[+<dimension>-<value>…].png (docs/e2e-flows.md#visual-goldens).
import path from "node:path";
import { MATRIX, PLATFORMS } from "../format/primitives.ts";
import type { Matrix, Platform } from "../runner/backend.ts";

const LOCALE = new RegExp(MATRIX.locale.pattern as string);
const APPEARANCES = MATRIX.appearance.enum as string[];
const NAME = /^[A-Za-z0-9_-]{1,100}(\+[A-Za-z][A-Za-z0-9]*-[A-Za-z0-9-]+)*$/;

/**
 * A golden's path relative to the e2e root. Appearance and locale are directories; every other matrix dimension is
 * appended to the file name as `+<dimension>-<value>`, sorted by dimension, so the path never depends on header order.
 */
export function goldenId(platform: Platform, matrix: Matrix, name: string): string {
  const missing = ["appearance", "locale"].filter(dimension => matrix[dimension] === undefined);
  if (missing.length) throw new Error(`a golden needs ${missing.join(" and ")} in the matrix`);
  const extra = Object.keys(matrix).filter(dimension => dimension !== "appearance" && dimension !== "locale").sort().map(dimension => `+${dimension}-${matrix[dimension]}`);
  return checkGoldenId(`${platform}/${matrix.appearance}/${matrix.locale}/${name}${extra.join("")}`);
}

/** Validates `<platform>/<appearance>/<locale>/<name>` and returns it. */
export function checkGoldenId(id: string): string {
  const [platform, appearance, locale, name, ...rest] = id.split("/");
  const problem = rest.length || name === undefined ? "it must be <platform>/<appearance>/<locale>/<name>"
    : !PLATFORMS.includes(platform as Platform) ? `platform ${JSON.stringify(platform)} is not one of ${PLATFORMS.join(", ")}`
    : !APPEARANCES.includes(appearance!) ? `appearance ${JSON.stringify(appearance)} is not one of ${APPEARANCES.join(", ")}`
    : !LOCALE.test(locale!) ? `locale ${JSON.stringify(locale)} is not a locale such as en or ar`
    : !NAME.test(name) ? `name ${JSON.stringify(name)} is not 1-100 letters, digits, _ and -, plus +<dimension>-<value> suffixes`
    : undefined;
  if (problem) throw new Error(`invalid golden ${JSON.stringify(id)}: ${problem}`);
  return id;
}

export const goldenFile = (root: string, id: string) => path.join(root, "golden", `${id}.png`);
