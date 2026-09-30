import type { CodexAppServer } from "./Codex.nitro";
/** Lazy so importing the capability is safe when the optional native module is absent. */
export function loadCodex(): CodexAppServer {
  const { NitroModules } = require("react-native-nitro-modules") as typeof import("react-native-nitro-modules");
  return NitroModules.createHybridObject<CodexAppServer>("CodexAppServer");
}
