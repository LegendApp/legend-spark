import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, View } from "react-native";
import { Text } from "./CameraText";
import { Camera, VisionCamera, useCameraDevices, useCameraPermission, useMicrophonePermission, usePhotoOutput, useVideoOutput, type CameraDevice, type Recorder } from "react-native-vision-camera";
import { NitroImage, type Image } from "react-native-nitro-image";
import { saveFileDialog } from "@legendapp/spark/dialogs";
import { revealInFileManager } from "@legendapp/spark/files";
import { writeText } from "@legendapp/spark/files";

export function CameraDemo() {
  const devices = useCameraDevices();
  const camera = useCameraPermission();
  const microphone = useMicrophonePermission();
  const [selected, setSelected] = useState<string>();
  const [active, setActive] = useState(false);
  const [audio, setAudio] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const report = useCallback((message: string) => setLog(previous => [`${new Date().toISOString()} ${message}`, ...previous].slice(0, 100)), []);
  const device = devices.find(d => d.id === selected) ?? devices[0];
  const action = useCallback(async (fn: () => unknown | Promise<unknown>) => { try { await fn(); } catch (e) { report(String(e)); } }, [report]);
  return <View style={{ gap: 14 }}>
    <Text style={{ fontSize: 22, fontWeight: "600" }}>Hardware test</Text>
    <Text>Camera permission: {camera.status} · Microphone: {microphone.status}</Text>
    {!camera.hasPermission && <Button title="Allow camera access" disabled={!camera.canRequestPermission} onPress={() => void action(async () => { report(`Camera permission: ${await camera.requestPermission()}`); })} />}
    {camera.status === "denied" && <Text>Enable this app in System Settings → Privacy & Security → Camera, then return here.</Text>}
    {devices.length === 0 ? <Text>No camera detected. Connect a USB camera or run this app on your other Mac. Hardware checks remain pending.</Text> : devices.map(d => <Button key={d.id} title={`${d.id === device?.id ? "✓ " : ""}${d.localizedName} (${d.position})`} disabled={active} onPress={() => setSelected(d.id)} />)}
    <Button title={audio ? "Audio enabled · disable" : "Enable microphone for videos"} disabled={active} onPress={() => void action(async () => { if (audio) setAudio(false); else if (microphone.hasPermission || await microphone.requestPermission()) setAudio(true); else report("Microphone permission was not granted"); })} />
    <Button title={active ? "Stop camera and close session" : "Start camera"} disabled={!active && (!device || !camera.hasPermission)} onPress={() => setActive(v => !v)} />
    {active && device && camera.hasPermission && <CaptureBoundary onError={report}><LiveCamera key={`${device.id}:${audio}`} device={device} audio={audio} report={report} /></CaptureBoundary>}
    <Text>Preview quality must be checked visually; this macOS prototype cannot report the preview’s first-frame event.</Text>
    <Text>Try: resize the window; capture and inspect a photo; record and play a video; stop and restart; unplug and reconnect a USB camera. Check audio playback if enabled.</Text>
    <Button title="Export hardware test log…" onPress={() => void action(async () => { const result = await saveFileDialog({ defaultName: "camera-test.json", filters: [{ extensions: ["json"] }] }); if (!result.canceled) { await writeText(result.path, JSON.stringify({ versions: { reactNativeMacOS: "0.81.7", visionCamera: "5.2.3", nitro: "0.37.0" }, devices: devices.map(d => ({ id: d.id, name: d.localizedName })), cameraPermission: camera.status, microphonePermission: microphone.status, log, visualChecks: "Please record visual quality, orientation, playback and reconnect results separately." }, null, 2)); report(`Saved ${result.path}`); } })} />
    {log.map((line, i) => <Text selectable key={i} style={{ fontFamily: "Menlo", fontSize: 11 }}>{line}</Text>)}
  </View>;
}
function LiveCamera({ device, audio, report }: { device: CameraDevice; audio: boolean; report: (message: string) => void }) {
  const photoOutput = usePhotoOutput({ containerFormat: "jpeg" });
  const videoOutput = useVideoOutput({ enableAudio: audio, enablePersistentRecorder: false });
  const outputs = useMemo(() => [photoOutput, videoOutput], [photoOutput, videoOutput]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [image, setImage] = useState<Image>();
  const [lastPath, setLastPath] = useState("");
  const recorder = useRef<Recorder | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; const r = recorder.current; if (r?.isRecording) void r.stopRecording().catch(console.error); }, []);
  // Rendered image wrappers can be frozen by RN; native view teardown releases them.
  const onError = useCallback((error: Error) => { setReady(false); report(`ERROR ${String(error)}`); }, [report]);
  const onStarted = useCallback(() => { setReady(true); report("Capture session started"); }, [report]);
  const onStopped = useCallback(() => { setReady(false); report("Capture session stopped"); }, [report]);
  const takePhoto = async () => {
    setBusy(true);
    try {
      const photo = await photoOutput.capturePhoto({ flashMode: "off" }, {});
      try {
        const path = await photo.saveToTemporaryFileAsync(); const result = await photo.toImageAsync();
        if (alive.current) { setLastPath(path); setImage(result); } else result.dispose();
        report(`Photo saved: ${path} (${photo.width} × ${photo.height})`);
      } finally { photo.dispose(); }
    } catch (error) { report(`PHOTO ERROR ${String(error)}`); }
    finally { if (alive.current) setBusy(false); }
  };
  const toggleRecording = async () => {
    setBusy(true);
    try {
      if (recorder.current?.isRecording) { await recorder.current.stopRecording(); }
      else {
        const r = await videoOutput.createRecorder({ maxDuration: 60 }); recorder.current = r;
        await r.startRecording((path, reason) => { report(`Video saved: ${path} (${reason})`); if (alive.current) { setLastPath(path); setRecording(false); } }, error => { report(`VIDEO ERROR ${String(error)}`); if (alive.current) setRecording(false); });
        if (alive.current) setRecording(true);
        report(`Recording started (${audio ? "with audio" : "silent"})`);
      }
    } catch (error) { report(`RECORDING ERROR ${String(error)}`); }
    finally { if (alive.current) setBusy(false); }
  };
  return <View style={{ gap: 12 }}>
    <Camera device={device} isActive={true} outputs={outputs} style={{ width: "100%", height: 360, backgroundColor: "#101820" }} resizeMode="contain" onError={onError} onStarted={onStarted} onStopped={onStopped} />
    <View style={{ flexDirection: "row", gap: 20 }}><Button title="Take photo" disabled={!ready || busy || recording} onPress={() => void takePhoto()} /><Button title={recording ? "Stop recording" : "Record video (max 60s)"} disabled={!ready || busy} onPress={() => void toggleRecording()} /></View>
    {lastPath && <><Text selectable>{lastPath}</Text><Button title="Show captured file in Finder" onPress={() => void revealInFileManager(lastPath).catch(e => report(String(e)))} /></>}
    {image && <NitroImage image={image} resizeMode="contain" style={{ width: "100%", height: 260 }} />}
  </View>;
}
class CaptureBoundary extends React.Component<React.PropsWithChildren<{ onError: (message: string) => void }>, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: Error) { return { error: String(error) }; }
  componentDidCatch(error: Error) { this.props.onError(`CAMERA INITIALIZATION ERROR ${String(error)}`); }
  render() { return this.state.error ? <Text style={{ color: "#b42318" }}>{this.state.error}</Text> : this.props.children; }
}
