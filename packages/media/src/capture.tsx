import { createElement } from "react";
import type { ViewProps } from "react-native";
import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { onDesktopEvent, type DesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import { getPermissionStatus, type PermissionKind } from "@legendapp/spark-permissions";
import DesktopCameraView from "./DesktopCameraViewNativeComponent";
import type { Spec } from "./NativeDesktopMedia";
import { call, checkBoolean, checkCallback, checkOptions, checkSignal, isNull, isNumber, isRecord, mediaAvailability, requireMedia, uniqueId } from "./shared";
export type { Availability } from "@legendapp/spark-desktop-app/src/contracts";

export type CaptureDeviceKind = "camera" | "microphone";
export interface CaptureDevice {
  /** Stable while the device is connected (AVCaptureDevice uniqueID). */
  id: string;
  name: string;
  kind: CaptureDeviceKind;
  /** The device macOS uses unless another is chosen. */
  default: boolean;
}
/** A written recording: `uri` is its absolute path, `duration` in seconds, `size` in bytes. */
export interface CaptureRecording { status: "recorded"; uri: string; duration: number; size: number }
export type CaptureRecordingOutcome = CaptureRecording | { status: "cancelled" };
/** A written image: `uri` is its absolute path; `width` and `height` in pixels. */
export interface CapturedImage { uri: string; width: number; height: number }
/** Microphone levels in dBFS (-160 silence, 0 full scale). */
export interface AudioLevel { average: number; peak: number }

export interface AudioRecordingOptions {
  /** A microphone from getCaptureDevices("microphone"). Default: the default microphone. */
  deviceId?: string;
  /** Where to write: an absolute path or file URL ending .m4a, in an existing directory, not an existing file. Default: a new temporary file. */
  uri?: string;
  /** Levels ten times a second while recording. */
  onLevel?: (level: AudioLevel) => void;
  /** Aborting cancels the recording (outcome cancelled, file deleted). */
  signal?: AbortSignal;
}
export interface CaptureRecordingSession {
  readonly id: string;
  /** Settles once: recorded, or cancelled; rejects when the device goes away (E_UNAVAILABLE) or capture fails. */
  readonly result: Promise<CaptureRecordingOutcome>;
  /** Stops and resolves with the result. */
  stop(): Promise<CaptureRecordingOutcome>;
  /** Stops and deletes the file; `result` resolves cancelled. */
  cancel(): Promise<void>;
}
export interface CameraOptions {
  /** A camera from getCaptureDevices("camera"). Default: the default camera. */
  deviceId?: string;
  /** Aborting stops the camera. */
  signal?: AbortSignal;
}
export interface CameraStatus { width: number; height: number }
export interface CameraSession {
  /** Identifies the camera to CameraView. */
  readonly id: string;
  /** Resolves once the camera stops; rejects when it goes away (E_UNAVAILABLE) or fails. */
  readonly ended: Promise<void>;
  /** A JPEG of what the camera sees. `uri`: an absolute path or file URL ending .jpg; default a new temporary file. */
  takePhoto(options?: { uri?: string }): Promise<CapturedImage>;
  /** The frame size in pixels; E_CLOSED once stopped. */
  getStatus(): Promise<CameraStatus>;
  /** Stops the camera. Idempotent. */
  stop(): Promise<void>;
}
export interface ScreenDisplaySource { id: number; width: number; height: number }
export interface ScreenWindowSource { id: number; title: string | null; app: string | null; width: number; height: number }
/** Sizes in points. */
export interface ScreenCaptureSources { displays: ScreenDisplaySource[]; windows: ScreenWindowSource[] }
export interface ScreenCaptureOptions {
  /** A display id from getScreenCaptureSources(). Default: the main display. */
  display?: number;
  /** A window id from getScreenCaptureSources(); not with `display`. */
  window?: number;
  /** Default true. */
  showsCursor?: boolean;
}
export interface ScreenshotOptions extends ScreenCaptureOptions {
  /** An absolute path or file URL ending .png. Default: a new temporary file. */
  uri?: string;
}
export interface ScreenRecordingOptions extends ScreenCaptureOptions {
  /** An absolute path or file URL ending .mov. Default: a new temporary file. */
  uri?: string;
  /** Aborting cancels the recording. */
  signal?: AbortSignal;
}
export type CameraContentFit = "contain" | "cover" | "fill";
export interface CameraViewProps extends ViewProps {
  /** The camera to show; null shows nothing. A camera may be shown by several views. */
  session: CameraSession | null;
  /** contain (default): letterboxed; cover: fills and crops; fill: stretches. */
  contentFit?: CameraContentFit;
}

/** What can be captured: a camera, a microphone, or the screen (sources and screenshots). */
export type CaptureKind = "camera" | "microphone" | "screen";
/** `missing-entitlement`: a hardened-runtime build without the entitlement the camera or microphone needs (macos.capture in the app config). */
export type CaptureAvailability = Availability | { available: false; reason: "missing-entitlement" };

type NativeAvailability = { camera: string; microphone: string; screenRecording: boolean };
const isNativeAvailability = (value: unknown): value is NativeAvailability => isRecord(value) && typeof value.screenRecording === "boolean"
  && ["camera", "microphone"].every(key => value[key] === "available" || value[key] === "missing-entitlement");
async function nativeAvailability() { return call(requireMedia("Capture"), "captureAvailability", {}, isNativeAvailability); }

/**
 * Whether `kind` can be captured on this platform and in this build. macOS only: Windows reports `unsupported-platform`
 * (#425). A camera or microphone in a hardened-runtime build without its entitlement reports `missing-entitlement`.
 * Permissions are separate (`@legendapp/spark/permissions`), and devices may still be absent (getCaptureDevices).
 */
export async function getCaptureAvailability(kind: CaptureKind): Promise<CaptureAvailability> {
  if (kind !== "camera" && kind !== "microphone" && kind !== "screen") throw new SparkError("E_INVALID_ARGUMENT", "A capture kind is camera, microphone or screen");
  const availability = mediaAvailability();
  if (!availability.available || kind === "screen") return availability;
  return (await nativeAvailability())[kind] === "available" ? { available: true } : { available: false, reason: "missing-entitlement" };
}

/** Whether this Mac records the screen to a file: `host-restriction` before macOS 15. */
export async function getScreenRecordingAvailability(): Promise<Availability> {
  const availability = mediaAvailability();
  if (!availability.available) return availability;
  return (await nativeAvailability()).screenRecording ? { available: true } : { available: false, reason: "host-restriction" };
}

const isDevice = (value: unknown): value is CaptureDevice => isRecord(value) && typeof value.id === "string" && typeof value.name === "string"
  && (value.kind === "camera" || value.kind === "microphone") && typeof value.default === "boolean";
/** The connected cameras or microphones. Never prompts or opens a device. */
export async function getCaptureDevices(kind: CaptureDeviceKind): Promise<CaptureDevice[]> {
  if (kind !== "camera" && kind !== "microphone") throw new SparkError("E_INVALID_ARGUMENT", "A capture device kind is camera or microphone");
  return call(requireMedia("Capture"), "captureDevices", { kind }, (value): value is CaptureDevice[] => Array.isArray(value) && value.every(isDevice));
}

/** Rejects E_PERMISSION_DENIED unless `kind` is granted: capture never prompts. */
async function requirePermission(kind: PermissionKind, feature: string) {
  const permission = await getPermissionStatus(kind);
  if (!permission.granted) throw new SparkError("E_PERMISSION_DENIED", `${feature} needs the ${kind} permission (${permission.status}); request it from a person's action first`);
}
function checkString(value: unknown, name: string) {
  if (value !== undefined && (typeof value !== "string" || !value)) throw new SparkError("E_INVALID_ARGUMENT", `${name} is a nonempty string`);
  return value as string | undefined;
}
function checkSource(options: Record<string, unknown>) {
  for (const key of ["display", "window"]) if (options[key] !== undefined && (!Number.isInteger(options[key]) || (options[key] as number) < 0)) throw new SparkError("E_INVALID_ARGUMENT", `${key} is a source id`);
  if (options.display !== undefined && options.window !== undefined) throw new SparkError("E_INVALID_ARGUMENT", "Capture a display or a window, not both");
  return { display: options.display, window: options.window, showsCursor: checkBoolean(options.showsCursor, "showsCursor") };
}

const isRecordingOutcome = (value: unknown): value is CaptureRecordingOutcome => isRecord(value) && (value.status === "cancelled"
  || (value.status === "recorded" && typeof value.uri === "string" && isNumber(value.duration) && isNumber(value.size)));
const isImage = (value: unknown): value is CapturedImage => isRecord(value) && typeof value.uri === "string" && isNumber(value.width) && isNumber(value.height);

/**
 * Starts a native session whose call settles when it ends, and resolves once it runs ("started"), or rejects with why it
 * did not start. Events other than "started" go to `onEvent`; aborting `signal` runs `abort`.
 */
async function startSession<T>(native: Spec, method: string, options: Record<string, unknown>, validate: (value: unknown) => value is T,
  signal: AbortSignal | undefined, abort: (id: string) => Promise<void>, onEvent?: (event: DesktopEvent) => void) {
  const id = uniqueId("capture");
  let started!: () => void;
  const running = new Promise<void>(resolve => { started = resolve; });
  const subscription = onDesktopEvent(event => { if (event.event === "started") started(); else onEvent?.(event); }, { types: ["capture"], target: { field: "id", value: id } });
  const ended = call(native, method, { id, options }, validate);
  const onAbort = () => { void abort(id).catch(console.error); };
  signal?.addEventListener("abort", onAbort, { once: true });
  const settled = ended.finally(() => { subscription.remove(); signal?.removeEventListener("abort", onAbort); });
  settled.catch(() => {}); // Rejections surface through the session and its start, not as unhandled.
  await Promise.race([running, settled]);
  return { id, settled };
}
const command = (native: Spec, method: string, id: string) => call(native, method, { id }, isNull).then(() => {});

/**
 * Records the microphone to an AAC (.m4a) file. Resolves once recording runs. Never prompts: rejects E_PERMISSION_DENIED
 * unless the microphone permission is granted, E_UNAVAILABLE without a microphone or its entitlement (getCaptureAvailability), E_NOT_FOUND for an unknown deviceId and
 * E_BUSY while another recording of the microphone runs.
 */
export async function startAudioRecording(options: AudioRecordingOptions = {}): Promise<CaptureRecordingSession> {
  const checked = checkOptions(options, ["deviceId", "uri", "onLevel", "signal"], "audio recording");
  const deviceId = checkString(checked.deviceId, "deviceId"), uri = checkString(checked.uri, "uri");
  checkCallback(checked.onLevel, "onLevel");
  const signal = checkSignal(checked.signal);
  const native = requireMedia("Audio recording");
  if (signal?.aborted) throw new SparkError("E_ABORTED", "The recording was aborted before it started");
  await requirePermission("microphone", "Audio recording");
  const onLevel = options.onLevel;
  const onEvent = onLevel && ((event: DesktopEvent) => {
    if (event.event !== "level" || !isNumber(event.average) || !isNumber(event.peak)) return;
    try { onLevel({ average: event.average, peak: event.peak }); } catch (error) { console.error(new SparkError("E_NATIVE", "The onLevel callback failed", { cause: error })); }
  });
  return recordingSession(native, "captureRecordAudio", { deviceId, uri, levels: !!onLevel }, signal, onEvent);
}

async function recordingSession(native: Spec, method: string, options: Record<string, unknown>, signal: AbortSignal | undefined, onEvent?: (event: DesktopEvent) => void): Promise<CaptureRecordingSession> {
  const cancel = (id: string) => command(native, "captureCancel", id);
  const { id, settled } = await startSession(native, method, options, isRecordingOutcome, signal, cancel, onEvent);
  return {
    id,
    result: settled,
    async stop() { await command(native, "captureStop", id); return settled; },
    async cancel() { await cancel(id); await settled.catch(() => {}); },
  };
}

/**
 * Starts a camera; show it with CameraView. Resolves once frames flow. Never prompts: rejects E_PERMISSION_DENIED unless
 * the camera permission is granted, E_UNAVAILABLE without a camera or its entitlement (getCaptureAvailability), E_NOT_FOUND for an unknown deviceId and E_BUSY while
 * another camera session runs.
 */
export async function startCamera(options: CameraOptions = {}): Promise<CameraSession> {
  const checked = checkOptions(options, ["deviceId", "signal"], "camera");
  const deviceId = checkString(checked.deviceId, "deviceId");
  const signal = checkSignal(checked.signal);
  const native = requireMedia("Camera");
  if (signal?.aborted) throw new SparkError("E_ABORTED", "The camera was aborted before it started");
  await requirePermission("camera", "The camera");
  const stop = (id: string) => command(native, "captureStop", id);
  const { id, settled } = await startSession(native, "captureCamera", { deviceId }, isNull, signal, stop);
  const ended = settled.then(() => {});
  ended.catch(() => {});
  return {
    id,
    ended,
    async takePhoto(photo = {}) {
      const uri = checkString(checkOptions(photo, ["uri"], "photo").uri, "uri");
      return call(native, "capturePhoto", { id, options: { uri } }, isImage);
    },
    getStatus: () => call(native, "captureCameraStatus", { id }, (value): value is CameraStatus => isRecord(value) && isNumber(value.width) && isNumber(value.height)),
    async stop() { await stop(id); await ended.catch(() => {}); },
  };
}

/** The displays and windows that can be captured. Never prompts: rejects E_PERMISSION_DENIED unless screenRecording is granted. */
export async function getScreenCaptureSources(): Promise<ScreenCaptureSources> {
  const native = requireMedia("Screen capture");
  await requirePermission("screenRecording", "Screen capture");
  return call(native, "captureScreenSources", {}, (value): value is ScreenCaptureSources => isRecord(value) && Array.isArray(value.displays) && Array.isArray(value.windows)
    && value.displays.every(display => isRecord(display) && ["id", "width", "height"].every(key => isNumber(display[key])))
    && value.windows.every(window => isRecord(window) && ["id", "width", "height"].every(key => isNumber(window[key])) && (window.title === null || typeof window.title === "string") && (window.app === null || typeof window.app === "string")));
}

/** A PNG of a display (default the main one) or a window at its pixel size. Never prompts (E_PERMISSION_DENIED); E_NOT_FOUND for an unknown source. */
export async function captureScreenshot(options: ScreenshotOptions = {}): Promise<CapturedImage> {
  const checked = checkOptions(options, ["display", "window", "showsCursor", "uri"], "screenshot");
  const source = checkSource(checked), uri = checkString(checked.uri, "uri");
  const native = requireMedia("Screen capture");
  await requirePermission("screenRecording", "Screen capture");
  return call(native, "captureScreenshot", { options: { ...source, uri } }, isImage);
}

/**
 * Records a display (default the main one) or a window to a QuickTime movie (.mov). Resolves once recording runs. Never
 * prompts (E_PERMISSION_DENIED); E_UNAVAILABLE before macOS 15 (getScreenRecordingAvailability), E_NOT_FOUND for an
 * unknown source, E_BUSY while another screen recording runs. Stopping from the macOS menu bar rejects `result` E_ABORTED.
 */
export async function startScreenRecording(options: ScreenRecordingOptions = {}): Promise<CaptureRecordingSession> {
  const checked = checkOptions(options, ["display", "window", "showsCursor", "uri", "signal"], "screen recording");
  const source = checkSource(checked), uri = checkString(checked.uri, "uri");
  const signal = checkSignal(checked.signal);
  const native = requireMedia("Screen recording");
  if (signal?.aborted) throw new SparkError("E_ABORTED", "The recording was aborted before it started");
  await requirePermission("screenRecording", "Screen recording");
  return recordingSession(native, "captureRecordScreen", { ...source, uri }, signal);
}

const FITS: readonly CameraContentFit[] = ["contain", "cover", "fill"];
/** Shows a camera's live preview behind any children. */
export function CameraView({ session, contentFit = "contain", ...props }: CameraViewProps) {
  requireMedia("CameraView");
  if (!FITS.includes(contentFit)) throw new SparkError("E_INVALID_ARGUMENT", "contentFit is contain, cover or fill");
  return createElement(DesktopCameraView, { ...props, sessionId: session?.id ?? "", contentFit });
}
