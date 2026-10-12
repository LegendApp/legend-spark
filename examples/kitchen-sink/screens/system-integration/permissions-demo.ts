import { useCallback, useRef, useState } from "react";
import { SparkError } from "@legendapp/spark/contracts";
import {
  addPermissionListener, getPermissionAvailability, getPermissionStatus, openPermissionSettings, requestPermission,
  type PermissionKind, type PermissionOptions, type PermissionResponse,
} from "@legendapp/spark/permissions";
import { useRegistrations } from "../../shell/registrations";
import { describeError } from "../app-lifecycle/useAppLifecycle";

export const PERMISSION_KINDS: readonly PermissionKind[] = ["camera", "microphone", "screenRecording", "accessibility", "inputMonitoring", "automation", "contacts", "calendar", "photos", "location", "speechRecognition"];
/** Automation is per target app; the screen asks about Finder, which is always running. */
export const AUTOMATION_TARGET = "com.apple.finder";
const options = (kind: PermissionKind): PermissionOptions => kind === "automation" ? { target: AUTOMATION_TARGET } : {};
/** "undetermined (notDetermined)": the portable status, then the macOS authorization. */
export const describePermission = (permission: PermissionResponse) => `${permission.status} (${permission.macos?.authorization})`;
/** Results show only the error code, so flows can assert them in any locale. */
const code = (cause: unknown) => cause instanceof SparkError ? `SparkError:${cause.code}` : String(cause);
export type PermissionEventEntry = { key: number; text: string };
/** Newest first; the screen keeps the last eight. */
const KEEP = 8;

/**
 * Every kind's state through @legendapp/spark/permissions, requests and System Settings links, and the change events.
 * Opening the screen only reads states; nothing prompts until a Request button is pressed. In a test-driver run every
 * call goes to the simulated state (docs/permissions.md#testing), so no TCC prompt or System Settings appears.
 */
export function usePermissionsDemo() {
  const [statuses, setStatuses] = useState<Partial<Record<PermissionKind, string>>>({});
  const [results, setResults] = useState<Partial<Record<PermissionKind, string>>>({});
  const [events, setEvents] = useState<readonly PermissionEventEntry[]>([]);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string>();
  const received = useRef(0);
  const report = useCallback((cause: unknown) => setError(describeError(cause)), []);
  const show = useCallback((kind: PermissionKind, text: string) => setStatuses(current => ({ ...current, [kind]: text })), []);
  useRegistrations(hold => {
    // A first read that arrives after a change event or request is older than what they showed.
    const first = (kind: PermissionKind, text: string) => setStatuses(current => kind in current ? current : { ...current, [kind]: text });
    for (const kind of PERMISSION_KINDS) getPermissionStatus(kind, options(kind)).then(permission => first(kind, describePermission(permission)), cause => first(kind, code(cause)));
    hold(addPermissionListener(({ kind, permission, previous }) => {
      show(kind, describePermission(permission));
      setEvents(list => [{ key: ++received.current, text: `${kind}: ${previous.status} → ${permission.status}` }, ...list].slice(0, KEEP));
    }, { onError: report }).then(registration => { setListening(true); return registration; }));
  }, report, [show, report]);

  const run = useCallback(async (kind: PermissionKind, action: "request" | "settings") => {
    let result: string;
    try {
      if (action === "settings") { await openPermissionSettings(kind); result = "opened"; }
      else {
        const permission = await requestPermission(kind, options(kind));
        show(kind, describePermission(permission));
        result = describePermission(permission);
      }
    } catch (cause) { result = code(cause); }
    setResults(current => ({ ...current, [kind]: result }));
  }, [show]);

  return { availability: getPermissionAvailability(), statuses, results, events, listening, error, run };
}
