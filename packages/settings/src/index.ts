import * as files from "@legendapp/spark-file-system";
import { settingsFilename } from "./filename";
import { createSettingsStore } from "./store";
import { fileStorage } from "./fileStorage";
export { createSettingsStore, type Json, type SettingsStorage, type SettingsStore, type SettingsStoreOptions, type SettingsReadOptions } from "./store";
let directory: Promise<string> | undefined;
async function file(key: string) {
  directory ??= files.getDirectory("data").then(async root => {
    const dir = `${root}/settings`; await files.mkdir(dir); return dir;
  }).catch(error => { directory = undefined; throw error; });
  return `${await directory}/${settingsFilename(key)}`;
}
export const settings = createSettingsStore({ storage: {
  async read(key) { return fileStorage.read(await file(key)); },
  async write(key, value) { await fileStorage.write(await file(key), value); },
  async remove(key) { await fileStorage.remove(await file(key)); },
} });
