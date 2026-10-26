import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ScrollView, View } from "react-native";
import { Text } from "./CameraText";
import { Images, NitroImage, type Image } from "react-native-nitro-image";
import { NativePreviewView, VisionCamera, type CameraPreviewOutput, type PreviewView } from "react-native-vision-camera";
import { callback } from "react-native-nitro-modules";
import { writeText } from "@legendapp/spark/files";
import KitchenSink from "./KitchenSink";
import { NitroCompatibility, type ProofCheck } from "./NitroCompatibility";
import { CameraDemo } from "./CameraDemo";

export default function App(props: React.ComponentProps<typeof KitchenSink>) {
  const [tab, setTab] = useState("camera");
  const args = props.launchArguments ?? [];
  const at = args.indexOf("--spark-camera-proof");
  const report = at >= 0 ? args[at + 1] : undefined;
  if (props.windowId && props.windowId !== "main") return <KitchenSink {...props} />;
  return <View style={{ flex: 1, backgroundColor: "#f4f6f8" }}>
    <View style={{ padding: 20, flexDirection: "row", gap: 20 }}>
      <Button title="Camera prototype" onPress={() => setTab("camera")} />
      <Button title="Desktop kitchen sink" onPress={() => setTab("desktop")} />
    </View>
    {tab === "desktop" ? <KitchenSink {...props} /> : <CameraPage report={report} />}
  </View>;
}
function CameraPage({ report }: { report?: string }) {
  const [nitro, setNitro] = useState<boolean>();
  const [checks, setChecks] = useState<ProofCheck[]>([]);
  const [image, setImage] = useState<Image>();
  const [preview, setPreview] = useState<CameraPreviewOutput>();
  const previewRef = useRef<PreviewView | null>(null);
  const hybridRef = useMemo(() => callback((view: PreviewView) => { previewRef.current = view; }), []);
  const [complete, setComplete] = useState(false);
  const onNitroComplete = useCallback((passed: boolean) => setNitro(passed), []);
  useEffect(() => {
    let cancelled = false;
    // Dispose temporary objects explicitly. Objects passed as native view props are
    // frozen by RN in development; those live until view teardown and Hermes GC.
    const objects: { dispose(): void }[] = [];
    const results: ProofCheck[] = [];
    const check = (name: string, passed: boolean, detail?: unknown) => { results.push({ name, passed, detail }); if (!cancelled) setChecks([...results]); if (!passed) throw new Error(name); };
    void (async () => {
      try {
        const blank = Images.createBlankImage(3, 2, true, { r: 1, g: 0, b: 0, a: 1 }); objects.push(blank);
        const raw = blank.toRawPixelData(); const bytes = new Uint8Array(raw.buffer);
        check("Native RGBA pixels and row stride", raw.width === 3 && raw.height === 2 && bytes.length === 24 && bytes.every((value, index) => value === ([255, 0, 0, 255][index % 4])), { bytes: Array.from(bytes) });
        const pixels = new Uint8Array([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255]);
        const pattern = Images.loadFromRawPixelData({ buffer: pixels.buffer, width: 2, height: 2, pixelFormat: "RGBA" }); objects.push(pattern);
        check("Raw image preserves pixel order", new Uint8Array(pattern.toRawPixelData().buffer).every((v, i) => v === pixels[i]));
        const mirrored = pattern.mirrorHorizontally(); objects.push(mirrored);
        const expectedMirror = [0,255,0,255, 255,0,0,255, 255,255,255,255, 0,0,255,255];
        check("Horizontal image mirror", new Uint8Array(mirrored.toRawPixelData().buffer).every((v, i) => v === expectedMirror[i]));
        const encoded = await blank.toEncodedImageDataAsync("png");
        const decoded = await Images.loadFromEncodedImageDataAsync(encoded); objects.push(decoded);
        check("PNG encode and decode", decoded.width === 3 && decoded.height === 2 && new Uint8Array(decoded.toRawPixelData().buffer).every((v, i) => v === bytes[i]));
        const resized = await decoded.resizeAsync(96, 64); objects.push(resized);
        check("Native image resize", resized.width === 96 && resized.height === 64);
        const path = await resized.saveToTemporaryFileAsync("png");
        const loaded = await Images.loadFromFileAsync(path);
        check("Image file save and reload", loaded.width === 96 && loaded.height === 64);
        if (!cancelled) setImage(loaded);
        const factory = await VisionCamera.createDeviceFactory(); objects.push(factory);
        const devices = factory.cameraDevices;
        check("Camera native module and device discovery", Array.isArray(devices), { count: devices.length, devices: devices.map(d => ({ id: d.id, name: d.localizedName, position: d.position })) });
        const session = await VisionCamera.createCameraSession(false); objects.push(session);
        check("Native capture session creation", session.isRunning === false);
        await session.stop();
        const preview = VisionCamera.createPreviewOutput();
        check("Native preview output creation", preview != null);
        if (!cancelled) setPreview(preview);
        for (let i = 0; i < 100 && previewRef.current == null; i++) await new Promise(resolve => setTimeout(resolve, 50));
        check("VisionCamera AppKit preview view mounts", previewRef.current?.previewOutput?.equals(preview) === true);
        const photo = VisionCamera.createPhotoOutput({ targetResolution: { width: 1920, height: 1080 }, containerFormat: "jpeg", quality: 0.9, qualityPrioritization: "balanced" }); objects.push(photo);
        check("Native photo output creation", !photo.supportsDepthDataDelivery);
        const video = VisionCamera.createVideoOutput({ targetResolution: { width: 1920, height: 1080 }, enableAudio: false, enablePersistentRecorder: false }); objects.push(video);
        check("Native video output creation", video != null);
        let rejected = false; try { await VisionCamera.createCameraSession(true); } catch { rejected = true; }
        check("Unsupported multi-camera request rejects", !VisionCamera.supportsMultiCamSessions && rejected);
      } catch (error) { if (!cancelled) setChecks([...results, { name: "Camera-free checks", passed: false, detail: String(error) }]); }
      finally { if (!cancelled) setComplete(true); }
    })();
    return () => { cancelled = true; objects.forEach(object => object.dispose()); };
  }, []);
  useEffect(() => {
    if (!complete || nitro === undefined || !report) return;
    void writeText(report, JSON.stringify({ passed: nitro && checks.length > 0 && checks.every(c => c.passed), versions: { reactNative: "0.83.10", reactNativeMacOS: "0.83.0", nitro: "0.37.0", nitroImage: "0.15.2", visionCamera: "5.2.3" }, results: checks, nativeViewPassed: nitro, hardwareChecks: "Pending on a Mac with a camera: permission, preview, photo, video, microphone, device reconnect" }, null, 2)).catch(console.error);
  }, [complete, nitro, checks, report]);
  return <ScrollView contentContainerStyle={{ padding: 28, gap: 20 }}>
    <Text style={{ fontSize: 28, fontWeight: "700" }}>VisionCamera for macOS · prototype</Text>
    <Text>RN macOS 0.83.0 · VisionCamera 5.2.3 · Nitro 0.37.0 · macOS 14+ · Apple Silicon</Text>
    <Text>Camera-free checks run automatically. Use the controls below on a Mac with a camera to verify preview and capture.</Text>
    {complete && checks.every(c => c.passed) && <CameraDemo />}
    <NitroCompatibility onComplete={onNitroComplete} />
    {checks.map((c, i) => <Text key={i} style={{ color: c.passed ? "#17633f" : "#b42318" }}>{c.passed ? "PASS" : "FAIL"} · {c.name}{!c.passed ? `: ${String(c.detail)}` : ""}</Text>)}
    {preview && <View><Text>Unconnected native preview · blank until a camera is started below</Text><NativePreviewView previewOutput={preview} hybridRef={hybridRef} style={{ width: 280, height: 100, backgroundColor: "#18232e" }} /></View>}
    {image && <View style={{ gap: 8 }}><Text>Synthetic image · should appear solid red</Text><NitroImage image={image} style={{ width: 144, height: 96 }} resizeMode="contain" /></View>}
    <Text>Prototype limits: no multi-camera, depth capture, object scanning, stabilization, manual zoom or exposure controls, ThumbHash, or preview thumbnails. Camera hardware behavior is pending verification.</Text>
  </ScrollView>;
}
