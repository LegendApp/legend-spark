import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { AREAS } from "../examples/kitchen-sink/shell/areas.ts";
import { MESSAGES, type Locale } from "../examples/kitchen-sink/shell/i18n.ts";
import { createCatalog } from "../examples/kitchen-sink/shell/registry.ts";

// Each language other than English, and the script its strings are written in, so an untranslated copy fails.
const SCRIPTS: Record<Exclude<Locale, "en">, RegExp> = { ar: /\p{Script=Arabic}/u };
const translated = Object.keys(SCRIPTS) as (keyof typeof SCRIPTS)[];
const root = path.join(import.meta.dirname, "../examples/kitchen-sink/screens");

// Screen components need the native runtime, so each screens/<area>/index.tsx loads with its components stubbed;
// its *-messages modules (the screens' own titles) load for real.
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("../examples/kitchen-sink/shell/app-controller", () => ({ useI18n: () => { throw new Error("Screens do not render here."); } }));
const stub = new Proxy({}, { has: () => true, get: (_, key) => key === "then" ? undefined : () => null });
async function loadScreens() {
  const modules = [];
  for (const area of readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)) {
    const index = path.join(root, area, "index.tsx");
    for (const [, specifier] of readFileSync(index, "utf8").matchAll(/from "(\.\/[^"]+)"/g))
      if (!specifier!.endsWith("-messages")) vi.doMock(path.join(root, area, specifier!), () => stub);
    modules.push([`./${area}/index.tsx`, await import(index)] as const);
  }
  return createCatalog(modules);
}

test("every registered screen has a title and summary in every language the shell speaks", async () => {
  const screens = (await loadScreens()).areas.flatMap(area => area.screens.map(screen => ({ area: area.id, ...screen })));
  expect(screens.length).toBeGreaterThan(10);
  const missing = screens.flatMap(screen => translated.flatMap(locale =>
    [["titles", screen.titles?.[locale]], ["summaries", screen.summaries?.[locale]]].filter(([, value]) => !SCRIPTS[locale].test(value ?? ""))
      .map(([field]) => `${screen.area}/${screen.id} ${field}.${locale}`)));
  expect(missing).toEqual([]);
});

test("every area has a name in every language the shell speaks", () => {
  for (const locale of translated) expect(AREAS.filter(area => !SCRIPTS[locale].test(MESSAGES[locale].areas[area.id] ?? "")).map(area => area.id)).toEqual([]);
});
