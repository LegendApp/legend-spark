import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { CameraView } from "@legendapp/spark/capture";
import { Button } from "@legendapp/spark/ui/uniwind";
import { useCaptureDemo } from "./capture-demo";
import { useCaptureMessages } from "./capture-messages";

// Test IDs: media-capture-availability ("camera available · microphone missing-entitlement · screen available"),
// -screen-recording-availability, -devices and -refresh (reads them again), -permissions; -request asks for the
// microphone, camera and screen recording permissions (-request-result shows a failure). Microphone: -record, -stop and
// -cancel; -level, -audio ("recording", "recorded .m4a", "cancelled" or an error) and -audio-detail. Camera:
// -start-camera, -take-photo, -stop-camera, -preview, -camera ("running · 1280×720", "stopped" or an error) and -photo.
// Screen: -list-sources and -sources, -screenshot and -screenshot-result, -record-screen and -stop-screen, -screen-recording.
const ID = "media-capture";

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return <View className="gap-2">
    <Text className="text-base font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    <View className="gap-2 rounded-md border border-border p-3" testID={`${ID}-${id}`}>{children}</View>
  </View>;
}

/** Microphone recording with levels, the camera with its preview and photos, and screen capture (@legendapp/spark/capture). */
export function Capture() {
  const t = useCaptureMessages();
  const { supported, availability, screenRecording, refresh, devices, permissions, level, results, details, camera, request, record, finish, openCamera, takePhoto, stopCamera, listSources, screenshot } = useCaptureDemo();
  const mono = (id: string, value: string | undefined, fallback: string, muted = false) => <Text selectable className={`font-mono text-xs ${muted ? "text-muted" : "text-foreground"}`} testID={`${ID}-${id}`}>{value ?? fallback}</Text>;
  const button = (id: string, label: string, onPress: () => Promise<void>) => <Button testID={`${ID}-${id}`} onPress={() => void onPress()}>{label}</Button>;
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6" testID={`${ID}-content`}>
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="text-sm text-muted">{t.intro}</Text>
    <Section title={t.availability} id="availability-section">
      {mono("availability", availability, t.reading, true)}
      {mono("screen-recording-availability", screenRecording && (typeof screenRecording === "string" ? screenRecording : JSON.stringify(screenRecording)), t.reading, true)}
      {mono("devices", devices, t.reading, true)}
      <View className="flex-row flex-wrap gap-2">{button("refresh", t.refresh, refresh)}</View>
    </Section>
    <Section title={t.permissions} id="permissions-section">
      {mono("permissions", permissions, t.reading)}
      <View className="flex-row flex-wrap gap-2">{button("request", t.request, request)}</View>
      {results.request && mono("request-result", results.request, "")}
    </Section>
    <Section title={t.microphone} id="microphone">
      <View className="flex-row flex-wrap gap-2">
        {button("record", t.record, () => record("audio"))}
        {button("stop", t.stop, () => finish("audio", "stop"))}
        {button("cancel", t.cancel, () => finish("audio", "cancel"))}
      </View>
      {mono("level", level, t.noLevel)}
      {mono("audio", results.audio, t.notRecorded)}
      {details.audio && mono("audio-detail", details.audio, "", true)}
    </Section>
    <Section title={t.camera} id="camera-section">
      {supported && <CameraView session={camera} testID={`${ID}-preview`} accessibilityLabel={t.previewLabel} style={{ width: 320, height: 180, backgroundColor: "black" }} />}
      <View className="flex-row flex-wrap gap-2">
        {button("start-camera", t.startCamera, openCamera)}
        {button("take-photo", t.takePhoto, takePhoto)}
        {button("stop-camera", t.stopCamera, stopCamera)}
      </View>
      {mono("camera", results.camera, t.noCamera)}
      {mono("photo", results.photo, t.noPhoto)}
    </Section>
    <Section title={t.screen} id="screen">
      <View className="flex-row flex-wrap gap-2">
        {button("list-sources", t.listSources, listSources)}
        {button("screenshot", t.screenshot, screenshot)}
        {button("record-screen", t.recordScreen, () => record("screen"))}
        {button("stop-screen", t.stopScreen, () => finish("screen", "stop"))}
      </View>
      {mono("sources", results.sources, t.noSources)}
      {mono("screenshot-result", results.screenshot, t.noScreenshot)}
      {mono("screen-recording", results.screen, t.notRecorded)}
      {details.screen && mono("screen-detail", details.screen, "", true)}
      <Text className="text-xs text-muted">{t.driver}</Text>
    </Section>
  </ScrollView>;
}
