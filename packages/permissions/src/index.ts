import { Platform } from "react-native";
import { SparkError, asyncRegistration, invokeNative, nativeError, parseNativeResult, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { onDesktopEvent, type DesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import Native, { type Spec } from "./NativeDesktopPermissions";
export type { AsyncRegistration, Availability } from "@legendapp/spark-desktop-app/src/contracts";

/** Privacy permissions macOS asks the person to grant (TCC). */
export type PermissionKind =
  | "camera" | "microphone" | "screenRecording" | "accessibility" | "inputMonitoring"
  | "automation" | "contacts" | "calendar" | "photos" | "location" | "speechRecognition";
/**
 * The native state. `notGranted`: screen recording and accessibility, which macOS reports only as granted or not.
 * `writeOnly`: calendar access to add events but not read them. `unknown`: a state this SDK does not know (a newer macOS).
 */
export type MacOSPermissionAuthorization = "notDetermined" | "restricted" | "denied" | "authorized" | "writeOnly" | "notGranted" | "unknown";
/** A permission's state, as `getPermissionStatus` and `requestPermission` resolve it. `macos` carries the native authorization. */
export interface PermissionResponse {
  kind: PermissionKind;
  /** `denied` includes restricted (parental controls or a device profile), write-only calendar access and not granted. */
  status: "granted" | "denied" | "undetermined" | "unknown";
  granted: boolean;
  /** Whether requestPermission can still show the system prompt; null when macOS does not say. */
  canAskAgain: boolean | null;
  macos?: { authorization: MacOSPermissionAuthorization };
}
/** Options for `getPermissionStatus` and `requestPermission`. */
export interface PermissionOptions {
  /** Automation only, and required there: the bundle identifier of the app to send Apple events to. */
  target?: string;
}
/** Passed to an `addPermissionListener` listener when a permission's state changes: the new response and the one before it. */
export interface PermissionChangeEvent { kind: Exclude<PermissionKind, "automation">; permission: PermissionResponse; previous: PermissionResponse }
/** Options for `addPermissionListener`. */
export interface PermissionListenerOptions {
  /** Kinds to report. Default: every kind except automation, which is per target app and has no change events. */
  kinds?: readonly Exclude<PermissionKind, "automation">[];
  /** Malformed native events and errors thrown by `listener`. Default: console.error. */
  onError?: (error: SparkError) => void;
}

const KINDS: readonly PermissionKind[] = ["camera", "microphone", "screenRecording", "accessibility", "inputMonitoring", "automation", "contacts", "calendar", "photos", "location", "speechRecognition"];
const OBSERVED = KINDS.filter((kind): kind is Exclude<PermissionKind, "automation"> => kind !== "automation");
const AUTHORIZATIONS: Record<PermissionKind, readonly MacOSPermissionAuthorization[]> = {
  camera: ["notDetermined", "restricted", "denied", "authorized", "unknown"],
  microphone: ["notDetermined", "restricted", "denied", "authorized", "unknown"],
  screenRecording: ["notGranted", "authorized"],
  accessibility: ["notGranted", "authorized"],
  inputMonitoring: ["notDetermined", "denied", "authorized", "unknown"],
  automation: ["notDetermined", "denied", "authorized"],
  contacts: ["notDetermined", "restricted", "denied", "authorized", "unknown"],
  calendar: ["notDetermined", "restricted", "denied", "authorized", "writeOnly", "unknown"],
  photos: ["notDetermined", "restricted", "denied", "authorized", "unknown"],
  location: ["notDetermined", "restricted", "denied", "authorized", "unknown"],
  speechRecognition: ["notDetermined", "restricted", "denied", "authorized", "unknown"],
};

/** macOS only. Windows reports `unsupported-platform` (#378). */
export function getPermissionAvailability(): Availability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
function requireAvailable(): Spec {
  const availability = getPermissionAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Privacy permissions require macOS with NativeDesktopPermissions installed");
  return Native!;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function permissionKind(kind: unknown): PermissionKind {
  if (!KINDS.includes(kind as PermissionKind)) throw new SparkError("E_INVALID_ARGUMENT", `Unknown permission: ${String(kind)}`);
  return kind as PermissionKind;
}
function target(kind: PermissionKind, options: unknown): string | undefined {
  if (!isRecord(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected permission options");
  for (const key of Object.keys(options)) if (key !== "target") throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported permission option: ${key}`);
  if (kind !== "automation") {
    if (options.target !== undefined) throw new SparkError("E_UNSUPPORTED_OPTION", "Only automation takes a target");
    return undefined;
  }
  if (typeof options.target !== "string" || !/^[A-Za-z0-9.-]{1,255}$/.test(options.target)) throw new SparkError("E_INVALID_ARGUMENT", "Automation needs target: the bundle identifier of the app to automate");
  return options.target;
}

/** The portable view of a native authorization. */
function response(kind: PermissionKind, authorization: MacOSPermissionAuthorization): PermissionResponse {
  const granted = authorization === "authorized";
  const status = granted ? "granted" : authorization === "notDetermined" ? "undetermined" : authorization === "unknown" ? "unknown" : "denied";
  // writeOnly calendar access can be raised to full access with another prompt; notGranted says nothing about it.
  const canAskAgain = authorization === "notDetermined" || authorization === "writeOnly" ? true : authorization === "notGranted" || authorization === "unknown" ? null : false;
  return { kind, status, granted, canAskAgain, macos: { authorization } };
}
const isAuthorization = (kind: PermissionKind) => (value: unknown): value is MacOSPermissionAuthorization => AUTHORIZATIONS[kind].includes(value as MacOSPermissionAuthorization);

async function call(native: Spec, method: string, kind: PermissionKind, target?: string): Promise<PermissionResponse> {
  const json = await invokeNative(() => native.call(method, JSON.stringify({ kind, target })));
  return response(kind, parseNativeResult(json, isAuthorization(kind)));
}

/** Reads the current state without prompting. Automation asks the target app, which must be running (else E_NOT_FOUND). */
export async function getPermissionStatus(kind: PermissionKind, options: PermissionOptions = {}): Promise<PermissionResponse> {
  const checked = permissionKind(kind);
  const app = target(checked, options);
  return call(requireAvailable(), "status", checked, app);
}

/**
 * Shows the system prompt when macOS can, and resolves with the state once the person answers. When the state is
 * already decided it resolves at once without a prompt; screen recording and accessibility resolve at once either way
 * (macOS reports the answer later, as a change). Call it from a person's action. Rejects E_UNAVAILABLE when the app's
 * Info.plist lacks the usage description macOS requires (docs/permissions.md) or Location Services are off.
 */
export async function requestPermission(kind: PermissionKind, options: PermissionOptions = {}): Promise<PermissionResponse> {
  const checked = permissionKind(kind);
  const app = target(checked, options);
  return call(requireAvailable(), "request", checked, app);
}

/** Opens the kind's pane of System Settings > Privacy & Security. Resolves once macOS accepts the link. */
export async function openPermissionSettings(kind: PermissionKind): Promise<void> {
  const checked = permissionKind(kind);
  const native = requireAvailable();
  parseNativeResult(await invokeNative(() => native.call("openSettings", JSON.stringify({ kind: checked }))), (value): value is null => value === null);
}

const isSnapshot = (value: unknown): value is Record<Exclude<PermissionKind, "automation">, MacOSPermissionAuthorization> =>
  isRecord(value) && OBSERVED.every(kind => isAuthorization(kind)(value[kind]));
function report(options: PermissionListenerOptions, cause: unknown) { try { (options.onError ?? console.error)(nativeError(cause)); } catch (error) { console.error(error); } }

/**
 * Calls `listener` when a permission's state changes: after a request, when the app becomes active again (the person may
 * have changed System Settings meanwhile) and when macOS reports a location authorization change. Resolves once native
 * observation runs; it stops with the last listener. macOS ends an app when its screen recording permission changes.
 */
export async function addPermissionListener(listener: (event: PermissionChangeEvent) => void, options: PermissionListenerOptions = {}): Promise<AsyncRegistration> {
  if (typeof listener !== "function" || !isRecord(options) || (options.onError !== undefined && typeof options.onError !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Invalid permission listener");
  for (const key of Object.keys(options)) if (key !== "kinds" && key !== "onError") throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported permission listener option: ${key}`);
  if (options.kinds !== undefined && (!Array.isArray(options.kinds) || options.kinds.length === 0 || !options.kinds.every(kind => OBSERVED.includes(kind))))
    throw new SparkError("E_INVALID_ARGUMENT", "kinds lists permissions other than automation");
  const kinds = options.kinds ?? OBSERVED;
  const native = requireAvailable();
  let last: Record<string, MacOSPermissionAuthorization> | undefined, sequence = 0, stopped = false;
  const buffered: DesktopEvent[] = [];
  const consume = (event: DesktopEvent) => {
    if (stopped) return;
    if (!last) { buffered.push(event); return; }
    if (typeof event.sequence !== "number" || event.sequence <= sequence) return;
    sequence = event.sequence;
    if (!isSnapshot(event.permissions)) { report(options, new SparkError("E_INVALID_DATA", "Malformed permission event")); return; }
    const previous = last;
    last = event.permissions;
    for (const kind of kinds) {
      if (previous[kind] === last[kind]) continue;
      try { listener({ kind, permission: response(kind, last[kind]!), previous: response(kind, previous[kind]!) }); }
      catch (cause) { report(options, cause); }
    }
  };
  const subscription = onDesktopEvent(consume, { types: ["permissionsChanged"] });
  const unobserve = async () => { parseNativeResult(await invokeNative(() => native.call("unobserve", "{}")), (value): value is null => value === null); };
  let observing = false;
  try {
    // Native observation starts before the snapshot is validated, so a rejected snapshot must release it.
    const snapshot = parseNativeResult(await invokeNative(() => native.call("observe", "{}")), (value): value is unknown => true);
    observing = true;
    if (!isRecord(snapshot) || typeof snapshot.sequence !== "number" || !isSnapshot(snapshot.permissions)) throw new SparkError("E_INVALID_DATA", "Malformed permission snapshot");
    sequence = snapshot.sequence; last = snapshot.permissions;
    buffered.splice(0).forEach(consume);
  } catch (cause) {
    stopped = true; subscription.remove();
    if (observing) await unobserve().catch(error => report(options, error));
    throw cause;
  }
  return asyncRegistration(() => { stopped = true; subscription.remove(); }, unobserve);
}
