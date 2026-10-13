import { useCallback, useEffect, useRef, useState } from "react";
import type { Availability } from "@legendapp/spark/contracts";
import { getPermissionStatus, requestPermission } from "@legendapp/spark/permissions";
import {
  captureScreenshot, getCaptureAvailability, getCaptureDevices, getScreenCaptureSources, getScreenRecordingAvailability, startAudioRecording, startCamera,
  startScreenRecording, type CameraSession, type CaptureDevice, type CaptureRecordingOutcome, type CaptureRecordingSession,
} from "@legendapp/spark/capture";
import { describeFailure } from "./video-demo";

const KINDS = ["microphone", "camera", "screenRecording"] as const;
const extension = (uri: string) => uri.slice(uri.lastIndexOf(".") + 1);
const describeDevices = (devices: CaptureDevice[]) => devices.length ? devices.map(device => `${device.name}${device.default ? " (default)" : ""}`).join(", ") : "none";
/** "recorded .m4a" or "cancelled": stable for flows; the size and duration go to the detail line. */
const describeOutcome = (outcome: CaptureRecordingOutcome) => outcome.status === "recorded" ? `recorded .${extension(outcome.uri)}` : "cancelled";
const describeDetail = (outcome: CaptureRecordingOutcome) => outcome.status === "recorded" ? `${outcome.duration.toFixed(1)} s · ${outcome.size} bytes · ${outcome.uri}` : undefined;
export type RecordingKind = "audio" | "screen";
const CAPTURE_KINDS = ["camera", "microphone", "screen"] as const;

/** Runs `load` once mounted, and again whenever it changes. */
function useLoad(load: () => Promise<void>) { useEffect(() => { void load(); }, [load]); }

/**
 * Sessions the screen owns. `own(release)` registers one and returns how to unregister it; once the screen has unmounted
 * it releases the session at once and returns undefined, so a session that started late is not left running.
 * Unmounting releases every registered one.
 */
function useOwnedSessions() {
  const owned = useRef(new Set<() => Promise<void>>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const sessions = owned.current;
    return () => {
      mounted.current = false;
      for (const release of sessions) void release().catch(console.error);
      sessions.clear();
    };
  }, []);
  return useCallback((release: () => Promise<void>) => {
    if (!mounted.current) { void release().catch(console.error); return undefined; }
    owned.current.add(release);
    return () => { owned.current.delete(release); };
  }, []);
}

/**
 * The microphone, the camera and the screen through @legendapp/spark/capture. Opening the screen only reads availability,
 * devices and permissions; nothing records or opens a camera until a button is pressed, and leaving the screen ends
 * what it started. In a test-driver run every device is simulated (docs/capture.md#testing).
 */
export function useCaptureDemo() {
  const [availability, setAvailability] = useState<string>();
  const [supported, setSupported] = useState(false); // Whether capture exists here at all (macOS), so CameraView may render.
  const [devices, setDevices] = useState<string>();
  const [permissions, setPermissions] = useState<string>();
  const [screenRecording, setScreenRecording] = useState<Availability | string>();
  const [level, setLevel] = useState<string>();
  const [results, setResults] = useState<Partial<Record<RecordingKind | "camera" | "photo" | "sources" | "screenshot" | "request", string>>>({});
  const [details, setDetails] = useState<Partial<Record<RecordingKind, string>>>({});
  const [camera, setCamera] = useState<CameraSession | null>(null);
  const recordings = useRef<Partial<Record<RecordingKind, CaptureRecordingSession>>>({});
  const cameraRef = useRef<CameraSession | null>(null);
  const own = useOwnedSessions();
  const show = useCallback((key: keyof typeof results, text: string) => setResults(current => ({ ...current, [key]: text })), []);

  const refreshPermissions = useCallback(() => Promise.all(KINDS.map(kind => getPermissionStatus(kind).then(permission => `${kind} ${permission.status}`, describeFailure)))
    .then(states => setPermissions(states.join(" · "))), []);
  /** Availability per kind ("camera available · microphone missing-entitlement · …"), devices and permissions. */
  const refresh = useCallback(async () => {
    await Promise.all([
      Promise.all(CAPTURE_KINDS.map(kind => getCaptureAvailability(kind))).then(values => {
        setSupported(values[2]!.available);
        setAvailability(values.map((value, index) => `${CAPTURE_KINDS[index]} ${value.available ? "available" : value.reason}`).join(" · "));
      }, cause => setAvailability(describeFailure(cause))),
      Promise.all([getCaptureDevices("camera"), getCaptureDevices("microphone")])
        .then(([cameras, microphones]) => `cameras: ${describeDevices(cameras)} · microphones: ${describeDevices(microphones)}`, describeFailure).then(setDevices),
      getScreenRecordingAvailability().then(setScreenRecording, cause => setScreenRecording(describeFailure(cause))),
      refreshPermissions(),
    ]);
  }, [refreshPermissions]);
  useLoad(refresh);

  const request = useCallback(async () => {
    try { for (const kind of KINDS) await requestPermission(kind); }
    catch (cause) { show("request", describeFailure(cause)); }
    void refreshPermissions();
  }, [refreshPermissions, show]);

  const record = useCallback(async (kind: RecordingKind) => {
    setDetails(current => ({ ...current, [kind]: undefined }));
    if (kind === "audio") setLevel(undefined);
    let recording: CaptureRecordingSession | undefined;
    try {
      recording = kind === "audio"
        ? await startAudioRecording({ onLevel: next => setLevel(`level ${next.average.toFixed(0)} dB · peak ${next.peak.toFixed(0)} dB`) })
        : await startScreenRecording();
      const started = recording;
      // Leaving the screen discards the recording, also one that started after it left.
      const disown = own(() => started.cancel());
      if (!disown) return;
      recordings.current[kind] = recording;
      show(kind, "recording");
      const outcome = await recording.result.finally(disown);
      show(kind, describeOutcome(outcome));
      setDetails(current => ({ ...current, [kind]: describeDetail(outcome) }));
    } catch (cause) { show(kind, describeFailure(cause)); }
    // A start that failed (E_BUSY) leaves the running recording in place.
    if (recording && recordings.current[kind] === recording) delete recordings.current[kind];
  }, [own, show]);
  const finish = useCallback(async (kind: RecordingKind, action: "stop" | "cancel") => {
    try { await recordings.current[kind]?.[action](); }
    catch (cause) { show(kind, `${action}: ${describeFailure(cause)}`); }
  }, [show]);

  const openCamera = useCallback(async () => {
    let session: CameraSession | undefined;
    try {
      session = await startCamera();
      const started = session;
      const disown = own(() => started.stop());
      if (!disown) return;
      void session.ended.finally(disown).catch(() => {});
      cameraRef.current = session;
      setCamera(session);
      const status = await session.getStatus();
      show("camera", `running · ${status.width}×${status.height}`);
      await session.ended;
      show("camera", "stopped");
    } catch (cause) { show("camera", describeFailure(cause)); }
    if (session && cameraRef.current === session) { cameraRef.current = null; setCamera(null); }
  }, [own, show]);
  const takePhoto = useCallback(async () => {
    try {
      if (!cameraRef.current) return show("photo", "no camera");
      const photo = await cameraRef.current.takePhoto();
      show("photo", `photo .${extension(photo.uri)} · ${photo.width}×${photo.height}`);
    } catch (cause) { show("photo", describeFailure(cause)); }
  }, [show]);
  const stopCamera = useCallback(async () => {
    try { await cameraRef.current?.stop(); } catch (cause) { show("camera", `stop: ${describeFailure(cause)}`); }
  }, [show]);

  const listSources = useCallback(async () => {
    try {
      const sources = await getScreenCaptureSources();
      show("sources", `${sources.displays.length} displays · ${sources.windows.length} windows`);
    } catch (cause) { show("sources", describeFailure(cause)); }
  }, [show]);
  const screenshot = useCallback(async () => {
    try {
      const image = await captureScreenshot();
      show("screenshot", `screenshot .${extension(image.uri)} · ${image.width}×${image.height}`);
    } catch (cause) { show("screenshot", describeFailure(cause)); }
  }, [show]);

  return {
    supported, availability, screenRecording, refresh, devices, permissions, level, results, details, camera,
    request, record, finish, openCamera, takePhoto, stopCamera, listSources, screenshot,
  };
}
