import { useState } from "react";
import { getDevToolsAvailability, openDevTools } from "@legendapp/spark/devtools";
import { openNote, windows } from "../multiwindow/windows";

const errorText = (error: unknown) => `${(error as { code?: string }).code ?? "Error"}: ${error instanceof Error ? error.message : String(error)}`;

/** DevTools › React DevTools: open React Native DevTools (Components and Profiler) and the windows whose roots it lists. */
export function useReactDevToolsDemo(opened: string) {
  const availability = getDevToolsAvailability();
  const [result, setResult] = useState<string>();
  const report = (operation: () => Promise<string>) => operation().then(setResult, error => setResult(errorText(error)));
  return {
    availability, result,
    open: () => report(() => openDevTools({ runtime: "shared" }).then(() => opened)),
    // A second React root in the shared runtime, and a root in the isolated ks-plugins runtime (its own debug target).
    openNote: () => report(async () => (await openNote()).id),
    openIsolated: () => report(async () => (await windows.openInstance("plugin", { props: { label: "React DevTools" } })).id),
  };
}

/** The sample component's state: the Components panel shows and edits it, and the Profiler records its commits. */
export function useSampleCount() {
  const [count, setCount] = useState(0);
  return { count, increment: () => setCount(value => value + 1) };
}
