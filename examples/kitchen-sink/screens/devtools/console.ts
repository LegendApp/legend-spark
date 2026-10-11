import { openDevTools } from "@legendapp/spark/devtools";
import { probe } from "./probe";

// The shared runtime only (the worker runtime loads probe.ts, not this module).
export function throwUncaught() {
  setTimeout(() => { throw new Error("Kitchen Sink DevTools: an uncaught exception"); }, 0);
}

// In the shared runtime's DevTools console: ksDevTools.probe("console"), or ksDevTools.openDevTools({ runtime: "shared" }).
if (__DEV__) (globalThis as { ksDevTools?: unknown }).ksDevTools = { probe, throwUncaught, openDevTools };
