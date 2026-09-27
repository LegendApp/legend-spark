import * as files from "@legendapp/spark-file-system";
import { settingsFilename } from "./filename";
import { createSettingsStore } from "./store";
export { createSettingsStore, type Json, type SettingsStorage, type SettingsStore, type SettingsStoreOptions, type SettingsReadOptions } from "./store";
let directory: Promise<string> | undefined;
async function file(key: string) {
  directory ??= files.getDirectory("data").then(async root => {
    const dir = `${root}/settings`; await files.mkdir(dir); return dir;
  }).catch(error => { directory = undefined; throw error; });
  return `${await directory}/${settingsFilename(key)}`;
}
export const settings = createSettingsStore({ storage: {
  async read(key) {
    try { return await files.readText(await file(key)); }
    catch (error) { if ((error as { code?: string }).code === "E_NOT_FOUND") return undefined; throw error; }
  },
  async write(key, value) { await files.writeText(await file(key), value); },
  async remove(key) { await files.remove(await file(key)); },
} });
