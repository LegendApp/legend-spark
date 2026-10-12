import { useEffect, useState } from "react";
import { SparkError } from "@legendapp/spark/contracts";
import { addDisplayListener, getDisplayAvailability, getDisplayDetails, type AsyncRegistration, type DisplayChangeEvent, type DisplayDetails, type DisplayField } from "@legendapp/spark/displays";

/** The fields a display card shows, in order. */
export const SHOWN_FIELDS = ["persistentId", "origin", "size", "workArea", "scaleFactor", "safeArea", "refreshRate", "colorSpace", "edrHeadroom"] as const satisfies readonly DisplayField[];
export type ShownField = (typeof SHOWN_FIELDS)[number];
/** Key orders for the values flows compare as text (native JSON key order is not fixed). */
const KEYS: Partial<Record<ShownField, readonly string[]>> = {
  origin: ["x", "y"], size: ["width", "height"], workArea: ["x", "y", "width", "height"], safeArea: ["top", "left", "bottom", "right"],
  refreshRate: ["minimum", "maximum", "variable"], colorSpace: ["name", "gamut"], edrHeadroom: ["current", "potential", "reference"],
};
/** A field as JSON with a fixed key order, so it reads the same in every locale and run. */
export function shownValue(display: DisplayDetails, field: ShownField) {
  const value = display[field], keys = KEYS[field];
  return JSON.stringify(keys ? Object.fromEntries(keys.map(key => [key, (value as unknown as Record<string, unknown>)[key]])) : value);
}
export const describeError = (error: unknown) => error instanceof SparkError ? `SparkError:${error.code}` : error instanceof Error ? `Error: ${error.message}` : String(error);

export type LoggedChange = { number: number; event: DisplayChangeEvent };
/** Changes kept on screen, newest first. */
const LOG_SIZE = 5;

/**
 * The current displays and the changes reported since the screen opened. The listener is registered
 * first, so no change between reading the displays and listening is lost; a change wins over the read.
 */
export function useDisplaysDemo() {
  const [displays, setDisplays] = useState<DisplayDetails[]>();
  const [changes, setChanges] = useState<LoggedChange[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true, registration: AsyncRegistration | undefined;
    const fail = (cause: unknown) => { if (active) setError(describeError(cause)); };
    addDisplayListener(event => {
      setDisplays(event.displays);
      setChanges(current => [{ number: (current[0]?.number ?? 0) + 1, event }, ...current].slice(0, LOG_SIZE));
    }, { onError: fail })
      .then(async added => {
        if (!active) { await added.remove(); return; }
        registration = added;
        const read = await getDisplayDetails();
        if (active) setDisplays(current => current ?? read);
      })
      .catch(fail);
    return () => { active = false; void registration?.remove(); };
  }, []);
  return { availability: getDisplayAvailability(), displays, changes, error };
}
