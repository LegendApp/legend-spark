import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { PLUGIN_CAPABILITIES, type PluginCapability, type PluginContributions, type PluginManifest, type PluginResponse } from "./types";

const PLUGIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const CONTRIBUTION_ID = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const COMPONENT = /^[A-Za-z0-9_.:-]{1,200}$/;
const EXTENSION = /^[a-z0-9]{1,20}$/;
const MAX_ITEMS = 100;

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
function exactKeys(value: Record<string, unknown>, keys: readonly string[], what: string) {
  const extra = Object.keys(value).filter(key => !keys.includes(key));
  if (extra.length) throw new SparkError("E_INVALID_DATA", `${what} has unknown fields: ${extra.join(", ")}`);
}
function capabilities(value: unknown, what: string): PluginCapability[] {
  if (!Array.isArray(value) || value.some(item => !PLUGIN_CAPABILITIES.includes(item)) || new Set(value).size !== value.length) {
    throw new SparkError("E_INVALID_DATA", `${what} must list distinct capabilities from: ${PLUGIN_CAPABILITIES.join(", ")}`);
  }
  return value;
}

/** Structural checks only; API version compatibility and grants are checked when the plugin loads. */
export function validateManifest(value: unknown): PluginManifest {
  if (!isObject(value)) throw new SparkError("E_INVALID_DATA", "Plugin manifest must be an object");
  exactKeys(value, ["id", "name", "version", "apiVersion", "capabilities"], "Plugin manifest");
  const { id, name, version, apiVersion } = value;
  if (typeof id !== "string" || id.length > 100 || !PLUGIN_ID.test(id)) throw new SparkError("E_INVALID_DATA", "Plugin id must be a lowercase reverse-DNS name of at most 100 characters");
  if (!text(name, 100)) throw new SparkError("E_INVALID_DATA", `${id}: name must be 1–100 characters`);
  if (typeof version !== "string" || !SEMVER.test(version)) throw new SparkError("E_INVALID_DATA", `${id}: version must be a semantic version`);
  if (!Number.isSafeInteger(apiVersion) || (apiVersion as number) < 1) throw new SparkError("E_INVALID_DATA", `${id}: apiVersion must be a positive integer`);
  capabilities(value.capabilities, `${id}: capabilities`);
  return value as unknown as PluginManifest;
}

export function validateGrant(value: unknown, pluginId: string): PluginCapability[] {
  return capabilities(value, `${pluginId}: grant`);
}

const KINDS = { commands: "commands", panels: "panels", fileTypes: "fileTypes", menuItems: "menuItems" } as const satisfies Record<keyof PluginContributions, PluginCapability>;
const FIELDS: Record<keyof PluginContributions, readonly string[]> = {
  commands: ["id", "title"], panels: ["id", "title", "component"], fileTypes: ["id", "name", "extensions", "command"], menuItems: ["id", "title", "command"],
};

/**
 * Checks what an activated plugin registered. Contributing a kind the manifest did not request, or an ID outside the
 * plugin's namespace, is a sandbox violation (`E_PERMISSION_DENIED`); malformed data is `E_INVALID_DATA`.
 */
export function validateContributions(value: unknown, manifest: PluginManifest): Required<PluginContributions> {
  if (!isObject(value)) throw new SparkError("E_INVALID_DATA", `${manifest.id}: activate must return an object of contributions`);
  exactKeys(value, Object.keys(KINDS), `${manifest.id}: contributions`);
  const result: Required<PluginContributions> = { commands: [], panels: [], fileTypes: [], menuItems: [] };
  for (const kind of Object.keys(KINDS) as (keyof PluginContributions)[]) {
    const items = value[kind];
    if (items === undefined) continue;
    if (!Array.isArray(items) || items.length > MAX_ITEMS) throw new SparkError("E_INVALID_DATA", `${manifest.id}: ${kind} must be an array of at most ${MAX_ITEMS} items`);
    if (items.length && !manifest.capabilities.includes(KINDS[kind])) {
      throw new SparkError("E_PERMISSION_DENIED", `${manifest.id} registered ${kind} without the "${KINDS[kind]}" capability`);
    }
    const ids = new Set<string>();
    for (const item of items) {
      if (!isObject(item)) throw new SparkError("E_INVALID_DATA", `${manifest.id}: each of ${kind} must be an object`);
      exactKeys(item, FIELDS[kind], `${manifest.id}: ${kind} item`);
      const { id } = item;
      if (typeof id !== "string" || id.length > 200 || !CONTRIBUTION_ID.test(id)) throw new SparkError("E_INVALID_DATA", `${manifest.id}: ${kind} IDs must be lowercase dotted names of at most 200 characters`);
      if (!id.startsWith(`${manifest.id}.`)) throw new SparkError("E_PERMISSION_DENIED", `${manifest.id} registered ${id} outside its namespace "${manifest.id}."`);
      if (ids.has(id)) throw new SparkError("E_INVALID_DATA", `${manifest.id}: ${id} is registered twice`);
      ids.add(id);
      if (!text(kind === "fileTypes" ? item.name : item.title, 200)) throw new SparkError("E_INVALID_DATA", `${id}: ${kind === "fileTypes" ? "name" : "title"} must be 1–200 characters`);
      if (kind === "panels" && (typeof item.component !== "string" || !COMPONENT.test(item.component))) throw new SparkError("E_INVALID_DATA", `${id}: component must name a threaded component`);
      if (kind === "fileTypes" && (!Array.isArray(item.extensions) || item.extensions.length < 1 || item.extensions.length > 20 || item.extensions.some(ext => typeof ext !== "string" || !EXTENSION.test(ext)))) {
        throw new SparkError("E_INVALID_DATA", `${id}: extensions must be 1–20 lowercase extensions without the dot`);
      }
    }
    (result[kind] as unknown[]) = items;
  }
  const commands = new Set(result.commands.map(command => command.id));
  for (const item of [...result.fileTypes, ...result.menuItems]) {
    if (!commands.has(item.command)) throw new SparkError("E_INVALID_DATA", `${item.id}: command ${String(item.command)} is not one of the plugin's commands`);
  }
  return result;
}

export function isPluginResponse(value: unknown): value is PluginResponse {
  if (!isObject(value)) return false;
  if (value.ok === true) return "value" in value;
  return value.ok === false && isObject(value.error) && typeof value.error.name === "string" && typeof value.error.message === "string";
}
