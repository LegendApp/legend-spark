import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test } from "vitest";

// Spark's own native strings (packages/desktop-app/macos/Localization). SparkLocalizeMainMenu matches the
// desktop template's menu titles against these keys at launch, so a title without a key would stay English.
const root = path.join(import.meta.dirname, "..");
const localization = path.join(root, "packages/desktop-app/macos/Localization");
const unescape = (value: string) => value.replace(/\\(.)/g, (_, character: string) => character === "t" ? "\t" : character === "n" ? "\n" : character);
function table(language: string): Map<string, string> {
  const source = readFileSync(path.join(localization, `${language}.lproj/Spark.strings`), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const entries = new Map<string, string>();
  for (const line of source.split("\n").filter(line => line.trim())) {
    const match = /^"((?:[^"\\]|\\.)*)" = "((?:[^"\\]|\\.)*)";$/.exec(line);
    expect(match, `${language}: ${line}`).not.toBeNull();
    const key = unescape(match![1]!);
    expect(entries.has(key), `${language} repeats ${key}`).toBe(false);
    entries.set(key, unescape(match![2]!));
  }
  return entries;
}
const languages = readdirSync(localization).filter(name => name.endsWith(".lproj")).map(name => name.slice(0, -".lproj".length)).sort();
const en = table("en");

test("Spark's strings exist in English, Arabic and French with identical keys", () => {
  expect(languages).toEqual(["ar", "en", "fr"]);
  for (const [key, value] of en) expect(value, key).toBe(key);
  for (const language of languages) {
    const strings = table(language);
    expect([...strings.keys()], language).toEqual([...en.keys()]);
    for (const [key, value] of strings) {
      expect(value.trim(), `${language} ${key}`).not.toBe("");
      expect(value.split("%@").length, `${language} ${key} keeps its placeholders`).toBe(key.split("%@").length);
      expect(value.startsWith("\t"), `${language} ${key} keeps its leading tab`).toBe(key.startsWith("\t"));
    }
  }
});

test("every title in the desktop template's main menu has a Spark string", () => {
  const require = createRequire(path.join(root, "packages/config-plugin/package.json"));
  const template = path.join(path.dirname(require.resolve("expo-desktop-template-bare-minimum/package.json")), "macos/HelloWorld-macOS/Base.lproj/Main.storyboard");
  const storyboard = readFileSync(template, "utf8");
  const xml = (value: string) => value.replace(/&#x9;/g, "\t").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const titles = [...storyboard.matchAll(/<menu(?:Item)? [^>]*title="([^"]*)"/g), ...storyboard.matchAll(/<string key="title">([^<]*)<\/string>/g)].map(match => xml(match[1]!));
  expect(titles.length).toBeGreaterThan(100);
  // The app menu and its About, Hide, Quit and Help items carry the app name (SparkLocalizeMainMenu).
  const named = new Map([["HelloWorld", undefined], ["About HelloWorld", "About %@"], ["Hide HelloWorld", "Hide %@"], ["Quit HelloWorld", "Quit %@"], ["HelloWorld Help", "%@ Help"]]);
  for (const title of new Set(titles)) {
    if (named.has(title)) { const format = named.get(title); if (format) expect(en.has(format), format).toBe(true); continue; }
    expect(en.has(title), `Spark.strings has no "${title}"`).toBe(true);
  }
});

test("every string native code and JavaScript ask for is defined", () => {
  const sources: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "windows") visit(file);
      else if (/\.(mm|m|ts)$/.test(entry.name)) sources.push(readFileSync(file, "utf8"));
    }
  };
  visit(path.join(root, "packages"));
  const native = sources.flatMap(source => [...source.matchAll(/SparkLocalizedString\(@"((?:[^"\\]|\\.)*)"\)/g)].map(match => match[1]!));
  const javascript = sources.flatMap(source => [...source.matchAll(/withDefaults\(([^;]*)\)/g)].flatMap(match => [...match[1]!.matchAll(/"(OK|Cancel|Continue|Confirm)"/g)].map(key => key[1]!)));
  expect(native).toEqual(expect.arrayContaining(["%@ Help", "Search", "New Window", "Dragged item", "Music"]));
  expect(new Set(javascript)).toEqual(new Set(["OK", "Cancel", "Continue", "Confirm"]));
  for (const key of [...native, ...javascript]) expect(en.has(key), key).toBe(true);
});

test("every menu role published without a label has a standard title", () => {
  const menu = readFileSync(path.join(root, "packages/native-menu/ios/RNNativeMenu.mm"), "utf8");
  const body = /static NSString \*RoleTitle\(NSString \*role\) \{([\s\S]*?)\n\}/.exec(menu)![1]!;
  const titles = Object.fromEntries([...body.matchAll(/@"(\w+)": @"([^"]+)"/g)].map(match => [match[1]!, match[2]!]));
  const roles = /const roles: readonly string\[\] = \[([^\]]*)\]/.exec(readFileSync(path.join(root, "packages/desktop-app/src/contracts/menu.ts"), "utf8"))![1]!.match(/"(\w+)"/g)!.map(role => role.slice(1, -1));
  expect(Object.keys(titles).sort()).toEqual([...roles].sort());
  for (const title of Object.values(titles)) expect(en.has(title), title).toBe(true);
});
