import type { SettingsStorage } from "./store";
/** Loaded lazily so custom backends and observable types do not require a native host. */
export const fileStorage: SettingsStorage = {
  async read(path) {
    const files = await import("@legendapp/spark-file-system");
    try { return await files.readText(path); }
    catch (error) { if ((error as { code?: string }).code === "E_NOT_FOUND") return undefined; throw error; }
  },
  async write(path, value) { await (await import("@legendapp/spark-file-system")).writeText(path, value); },
  async remove(path) { await (await import("@legendapp/spark-file-system")).remove(path); },
};
