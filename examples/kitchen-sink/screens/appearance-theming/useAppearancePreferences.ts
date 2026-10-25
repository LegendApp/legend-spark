import { useCallback, useRef, useState } from "react";
import { SparkError } from "@legendapp/spark/contracts";
import { getAppearancePreferences, getSystemAvailability, onSystemEvent, type AppearancePreferences, type SystemEvent } from "@legendapp/spark/system";
import { setWindowOptions, type WindowAppearanceOptions } from "@legendapp/spark/windows";
import { useRegistrations } from "../../shell/registrations";

export type WindowAppearance = NonNullable<WindowAppearanceOptions["appearance"]>;
export type ReceivedEvent = { key: number; type: SystemEvent["type"] };
/** The events that invalidate appearance preferences. */
const TYPES = ["appearanceChanged", "systemColorsChanged", "accessibilityDisplayChanged"] as const satisfies readonly SystemEvent["type"][];
/** Newest first. */
const KEEP = 6;
export const describeError = (error: unknown) => error instanceof SparkError ? `SparkError:${error.code}` : error instanceof Error ? `Error: ${error.message}` : String(error);

/**
 * Appearance and accessibility display preferences from @legendapp/spark/system, re-read on each event that
 * invalidates them, and a per-window appearance override of `windowId` that is reset when the screen closes.
 */
export function useAppearancePreferences(windowId: string) {
  const [preferences, setPreferences] = useState<AppearancePreferences>();
  const [events, setEvents] = useState<readonly ReceivedEvent[]>([]);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string>();
  const [windowAppearance, setWindowAppearance] = useState<WindowAppearance>("system");
  const received = useRef(0), overridden = useRef(false);
  const report = useCallback((cause: unknown) => setError(describeError(cause)), []);
  const refresh = useCallback(() => { getAppearancePreferences().then(setPreferences, report); }, [report]);
  useRegistrations(hold => {
    refresh();
    hold(onSystemEvent(event => {
      if (!TYPES.includes(event.type as typeof TYPES[number])) return;
      setEvents(list => [{ key: ++received.current, type: event.type }, ...list].slice(0, KEEP));
      refresh();
    }).then(registration => { setListening(true); return registration; }));
    // The override belongs to this screen: leaving it restores the window to the app's appearance.
    hold({ remove: () => { if (overridden.current) { overridden.current = false; return setWindowOptions(windowId, { appearance: "system" }); } } });
  }, report, [refresh, report, windowId]);
  const overrideWindow = useCallback((appearance: WindowAppearance) => {
    setWindowOptions(windowId, { appearance }).then(() => { overridden.current = appearance !== "system"; setWindowAppearance(appearance); }, report);
  }, [report, windowId]);
  return { availability: getSystemAvailability("appearancePreferences"), preferences, events, listening, error, windowAppearance, overrideWindow };
}
