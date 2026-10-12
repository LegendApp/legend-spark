import { useCallback, useRef, useState } from "react";
import * as system from "@legendapp/spark/system";
import { useRegistrations } from "../../shell/registrations";
import { describeError } from "../app-lifecycle/useAppLifecycle";

export const SYSTEM_FEATURES = ["thermalState", "networkStatus", "memoryPressure", "lowPowerChanges", "timeZoneChanges"] as const satisfies readonly system.SystemFeature[];
export type ReceivedEvent = { key: number; event: system.SystemEvent };
/** Newest first; the screen keeps the last eight. */
const KEEP = 8;

/**
 * System information, the network path and live system events through @legendapp/spark/system. Events are
 * invalidations, so each one re-reads the information it may have changed. In a driver run, the
 * simulateSystemEvent flow command delivers events through the same registration (docs/system.md).
 */
export function useSystemState() {
  const [info, setInfo] = useState<system.SystemInfo>();
  const [network, setNetwork] = useState<system.NetworkStatus>();
  const [events, setEvents] = useState<readonly ReceivedEvent[]>([]);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string>();
  const received = useRef(0);
  const report = useCallback((cause: unknown) => setError(describeError(cause)), []);
  const refresh = useCallback(() => {
    system.getSystemInfo().then(setInfo, report);
    if (system.getSystemAvailability("networkStatus").available) system.getNetworkStatus().then(setNetwork, report);
  }, [report]);
  useRegistrations(hold => {
    refresh();
    hold(system.onSystemEvent(event => {
      setEvents(list => [{ key: ++received.current, event }, ...list].slice(0, KEEP));
      refresh();
    }).then(registration => { setListening(true); return registration; }));
  }, report, [refresh, report]);
  const availability = Object.fromEntries(SYSTEM_FEATURES.map(feature => [feature, system.getSystemAvailability(feature)])) as Record<(typeof SYSTEM_FEATURES)[number], ReturnType<typeof system.getSystemAvailability>>;
  return { availability, info, network, events, listening, error, refresh };
}
