import { useCallback, useEffect, useRef, useState } from "react";
import * as app from "@legendapp/spark/app";
import { SparkError } from "@legendapp/spark/contracts";
import { useRegistrations } from "../../shell/registrations";

export type RelaunchMode = "same" | "safe" | "normal";
export type RelaunchStatus = "idle" | "pending" | "approved" | "vetoed" | { error: string };
type SecondInstance = app.AppEventMap["secondInstance"] & { key: number };

// "same" lets the host reuse this launch's arguments; "normal" drops them, leaving safe mode.
const RELAUNCH: Record<RelaunchMode, app.RelaunchOptions> = { same: {}, safe: { arguments: ["--spark-safe-mode"] }, normal: { arguments: [] } };
export const describeError = (error: unknown) => error instanceof SparkError ? `SparkError:${error.code} ${error.message}` : String(error);

/** Launch state, forwarded second launches, an optional quit veto and relaunch, all through @legendapp/spark/app. */
export function useAppLifecycle() {
  const [context, setContext] = useState<app.AppContext>();
  const [error, setError] = useState<string>();
  const [launches, setLaunches] = useState<readonly SecondInstance[]>([]);
  const [vetoQuit, setVetoQuit] = useState(false);
  const [status, setStatus] = useState<RelaunchStatus>("idle");
  const received = useRef(0);
  const report = useCallback((cause: unknown) => setError(describeError(cause)), []);
  useEffect(() => {
    let active = true;
    app.getAppContext().then(value => { if (active) setContext(value); }, cause => { if (active) report(cause); });
    return () => { active = false; };
  }, [report]);
  // Newest first; the screen keeps the last five.
  useRegistrations(hold => { hold(app.addAppListener("secondInstance", event => setLaunches(list => [{ ...event, key: ++received.current }, ...list].slice(0, 5)))); }, report, [report]);
  useRegistrations(hold => { if (vetoQuit) hold(app.beforeQuit(() => false)); }, report, [vetoQuit, report]);
  const relaunch = useCallback(async (mode: RelaunchMode) => {
    setStatus("pending");
    try { setStatus((await app.relaunch(RELAUNCH[mode])).quitRequested ? "approved" : "vetoed"); }
    catch (cause) { setStatus({ error: describeError(cause) }); }
  }, []);
  return { availability: app.getAppAvailability(), context, error, launches, vetoQuit, setVetoQuit, status, relaunch };
}
