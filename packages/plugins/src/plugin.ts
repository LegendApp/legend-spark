import type { PluginEntryFunction, PluginImplementation, PluginJsonValue, PluginManifest, PluginRequest, PluginResponse } from "./types";

const failure = (error: unknown): PluginResponse => ({
  ok: false,
  error: error instanceof Error ? { name: error.name, message: error.message } : { name: "Error", message: String(error) },
});

/**
 * The plugin's side. Export the result wrapped in `runtimeFunction(...)` from a bundled module; the host runs it only in
 * the plugin's own isolated runtime. A throw from `activate`, a command or `deactivate` becomes a failed response, so it
 * reaches the host as a `PluginError` and never escapes into the runtime.
 */
export function definePlugin(manifest: PluginManifest, implementation: PluginImplementation): PluginEntryFunction {
  const commands = implementation.commands ?? {};
  const handler = (id: string) => Object.prototype.hasOwnProperty.call(commands, id) ? commands[id] : undefined;
  return async (request: PluginRequest): Promise<PluginResponse> => {
    try {
      if (request.pluginId !== manifest.id) throw new Error(`This entry belongs to ${manifest.id}, not ${request.pluginId}`);
      switch (request.kind) {
        case "activate": {
          if (request.apiVersion !== manifest.apiVersion) throw new Error(`${manifest.id} targets plugin API ${manifest.apiVersion}, not ${request.apiVersion}`);
          const contributions = (await implementation.activate?.({ pluginId: manifest.id, apiVersion: request.apiVersion })) ?? {};
          for (const command of contributions.commands ?? []) if (!handler(command.id)) throw new Error(`No handler for command ${command.id}`);
          return { ok: true, value: contributions as unknown as PluginJsonValue };
        }
        case "execute": {
          const run = handler(request.command);
          if (!run) throw new Error(`No handler for command ${request.command}`);
          const value = (await run(request.args)) ?? null;
          // The runtime boundary serializes the result; fail here, as the command's error, if it cannot.
          JSON.stringify(value);
          return { ok: true, value };
        }
        case "deactivate":
          await implementation.deactivate?.();
          return { ok: true, value: null };
        default:
          throw new Error(`Unknown plugin request ${(request as { kind?: unknown }).kind}`);
      }
    } catch (error) { return failure(error); }
  };
}
