import { useCallback, useEffect, useRef, useState } from "react";
import { exposeTestState } from "@legendapp/spark/app";
import { SparkError } from "@legendapp/spark/contracts";
import {
  deleteCrashReports, getCrashReportingAvailability, getCrashReportingConsent, getCrashReports, setCrashReportingConsent, simulateCrash,
  type CrashReport, type SimulatedCrashKind,
} from "@legendapp/spark/diagnostics";

/** `trap` is SIGTRAP on Apple silicon and SIGILL on Intel. */
export const KINDS: readonly SimulatedCrashKind[] = ["badAccess", "abort", "uncaughtException", "trap", "stackOverflow", "javascript"];
/** Reports kept on screen, newest first. */
const KEEP = 20;

export const availabilityText = () => JSON.stringify(getCrashReportingAvailability());
const describe = (value: unknown) => value instanceof SparkError ? `SparkError:${value.code}` : value instanceof Error ? `Error: ${value.message}` : String(value);

/**
 * How a simulated crash's report compares with what was asked for, as JSON for the screen and its flows:
 * native reports locate every frame in an image; JavaScript reports keep the engine's error name and stack.
 * `listed`: getCrashReports returns it afterwards. Which frame a native report names is checked by flows with
 * assertCrashSymbol on the exposed report, since a stripped release build names its frames only with its dSYMs.
 */
export function simulatedCheck(kind: SimulatedCrashKind, report: CrashReport, listed: boolean) {
  if (report.kind === "javascript") return JSON.stringify({ kind, report: report.kind, simulated: report.simulated, name: report.name, hasStack: !!report.stack, listed });
  return JSON.stringify({
    kind, report: report.kind, simulated: report.simulated, signal: report.signal, ...(report.exception ? { exception: report.exception.name } : {}),
    framesLocated: report.stack.length > 0 && report.stack.every(frame => frame.image !== undefined && frame.imageOffset !== undefined && frame.imageUUID !== undefined),
    listed,
  });
}

/** The last simulated crash's report, exposed to the test driver as `crashReporting.lastReport` (null before one). */
function useExposedReport() {
  const last = useRef<CrashReport | null>(null);
  useEffect(() => {
    const exposed = exposeTestState("crashReporting", () => ({ lastReport: last.current }));
    return () => exposed.remove();
  }, []);
  return last;
}

/** The user's consent, the reports on this Mac, simulated crashes and deleting reports. */
export function useCrashReportingDemo() {
  const [consent, setConsent] = useState<boolean>();
  const [reports, setReports] = useState<CrashReport[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<SimulatedCrashKind>();
  const [result, setResult] = useState<string>();
  const last = useExposedReport();

  const refresh = useCallback(async () => {
    const latest = await getCrashReports();
    setReports(latest.slice(0, KEEP));
    return latest;
  }, []);
  useEffect(() => {
    Promise.all([getCrashReportingConsent().then(setConsent), refresh()]).catch(cause => setError(describe(cause)));
  }, [refresh]);

  const toggleConsent = useCallback(async () => {
    try { await setCrashReportingConsent(!consent); setConsent(!consent); setError(undefined); }
    catch (cause) { setError(describe(cause)); }
  }, [consent]);
  const simulate = useCallback(async (kind: SimulatedCrashKind) => {
    setBusy(kind);
    setResult(undefined);
    try {
      const report = await simulateCrash(kind);
      last.current = report;
      const listed = (await refresh()).some(candidate => candidate.id === report.id);
      setResult(simulatedCheck(kind, report, listed));
    } catch (cause) { setResult(describe(cause)); }
    finally { setBusy(undefined); }
  }, [refresh, last]);
  const deleteAll = useCallback(async () => {
    try { await deleteCrashReports(); await refresh(); setResult(undefined); }
    catch (cause) { setError(describe(cause)); }
  }, [refresh]);

  const state = error ?? (consent === undefined ? "loading" : consent ? "consent on" : "consent off");
  return { consent, state, reports, busy, result, toggleConsent, simulate, deleteAll };
}
