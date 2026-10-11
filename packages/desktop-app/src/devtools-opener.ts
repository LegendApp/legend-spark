// Development builds only: @legendapp/spark/runtime-entry requires this inside `if (__DEV__)`, in the shared runtime.
import { registerDevToolsOpener } from "./contracts/developer-tools";
import { getDevToolsAvailability, openDevTools } from "./devtools";

/** The Developer menu's Open DevTools item opens the key window's runtime (shared or isolated). Without DevTools it stays disabled. */
export function installDevToolsOpener(): void {
  if (!getDevToolsAvailability().available) return;
  registerDevToolsOpener(target => openDevTools({ runtime: target.runtime === "shared" ? "shared" : { isolated: target.name } }));
}
