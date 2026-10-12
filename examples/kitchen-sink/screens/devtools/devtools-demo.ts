import { useEffect, useState } from "react";
import { ThreadedRuntime } from "@react-native-runtimes/core";
import { getDevToolsAvailability, openDevTools, type DevToolsRuntime } from "@legendapp/spark/devtools";
import { throwUncaught } from "./console";
import { probe } from "./probe";
import { WORKER, workerProbe } from "../../devtools-tasks";

export type WorkerState = { status: "off" | "starting" | "running" } | { status: "failed"; error: string };
export const errorText = (error: unknown) => `${(error as { code?: string }).code ?? "Error"}: ${error instanceof Error ? error.message : String(error)}`;

// Starts and destroys of the worker runtime run in order, so a quick remount never races a destroy.
let queue: Promise<unknown> = Promise.resolve();
export function serial<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation);
  queue = next.catch(() => undefined);
  return next;
}

/** The ks-devtools worker runs while the screen is shown in a development build, so it is listed as a debug target. */
export function useWorkerRuntime(enabled: boolean): WorkerState {
  const [state, setState] = useState<WorkerState>({ status: enabled ? "starting" : "off" });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    serial(() => ThreadedRuntime.run(WORKER, workerProbe, "start")).then(
      () => { if (live) setState({ status: "running" }); },
      error => { if (live) setState({ status: "failed", error: errorText(error) }); });
    return () => { live = false; void serial(() => ThreadedRuntime.destroy(WORKER)); };
  }, [enabled]);
  return state;
}

export function useDevToolsDemo(opened: string) {
  const availability = getDevToolsAvailability();
  const worker = useWorkerRuntime(availability.available);
  const [result, setResult] = useState<string>();
  const report = (operation: () => Promise<unknown>) => operation().then(value => setResult(typeof value === "string" ? value : JSON.stringify(value)), error => setResult(errorText(error)));
  return {
    availability, worker, result,
    open: (runtime: DevToolsRuntime) => report(() => openDevTools({ runtime }).then(() => opened)),
    runProbe: () => setResult(JSON.stringify(probe("button"))),
    runWorkerProbe: () => report(() => serial(() => ThreadedRuntime.run(WORKER, workerProbe, "button"))),
    throwUncaught,
  };
}
