import { useEffect } from "react";
import { Text, TurboModuleRegistry, type TurboModule } from "react-native";
import { createAudioPlayer, createMediaSession } from "@legendapp/spark/audio";
import * as files from "@legendapp/spark/files";
import type { TestDriver } from "./test-driver";
const driver = TurboModuleRegistry.get<TestDriver & TurboModule>("NativeSDKTestDriver");
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export function AudioChecks({ report, source }: { report: string; source: string }) {
  useEffect(() => {
    const timer = setTimeout(() => void (async () => {
      const results: { name: string; passed: boolean; error?: string }[] = [];
      async function check(name: string, action: () => Promise<void>) { try { await action(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: String(error) }); } }
      await check("native playback, volume, metadata, status subscription and disposal", async () => {
        const player = await createAudioPlayer({ uri: source, title: "Audio probe" });
        let observed = 0;
        const subscription = player.addListener("playbackStatusUpdate", () => observed++);
        try {
          await player.setVolume(0.25);
          assert(Math.abs((await player.getStatus()).volume - 0.25) < 0.01, "Volume did not reach native player");
          await player.setMetadata({ title: "Updated", artist: "Artist", albumTitle: "Album" });
          await player.play(); await delay(300); await player.pause(); await player.seekTo(0.5);
          assert(observed > 0 && (await player.getStatus()).currentTime >= 0.45, "Status/seek failed");
          if (driver) { const info = JSON.parse(await driver.call("mediaInfo", "{}")); assert(info.title === "Updated" && info.artist === "Artist", JSON.stringify(info)); }
          subscription.remove(); const count = observed; await delay(350); assert(observed === count, "Removed listener received status");
        } finally { subscription.remove(); await player.remove(); }
        let failed = false; try { await player.play(); } catch { failed = true; } assert(failed, "Removed player accepted playback");
      });
      await check("external media session metadata, command configuration and replacement", async () => {
        const first = await createMediaSession({ metadata: { title: "First" }, onCommand: () => {} });
        const second = await createMediaSession({ metadata: { title: "External", artist: "Someone" }, commands: ["play", "pause", "nextTrack", "seekTo"], playbackState: "playing", position: 12, duration: 60, onCommand: () => {} });
        try {
          await first.remove();
          await second.update({ position: 18, metadata: { title: "Replacement" } });
          if (driver) { const info = JSON.parse(await driver.call("mediaInfo", "{}")); assert(info.title === "Replacement" && info.position === 18 && info.next && !info.previous, JSON.stringify(info)); }
        } finally { await first.remove(); await second.remove(); }
        if (driver) { const info = JSON.parse(await driver.call("mediaInfo", "{}")); assert(!info.title, "Session metadata survived disposal"); }
      });
      await files.writeText(report, JSON.stringify({ passed: results.every(result => result.passed), nativeDriver: !!driver, results }, null, 2));
    })().catch(error => void files.writeText(report, JSON.stringify({ passed: false, error: String(error) }))), 250);
    return () => clearTimeout(timer);
  }, [report, source]);
  return <Text>Audio/media-session native checks</Text>;
}
