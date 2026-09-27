import { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { createMediaSession, type MediaSession } from "@legendapp/spark/audio";
import { ActionButton } from "./ActionButton";
import { EventResults, useEventResults } from "./EventResults";
export function MediaSessionDemo({ report }: { report: (value: unknown) => void }) {
  const session = useRef<MediaSession | undefined>(undefined);
  const active = useRef(false);
  const [entries, log] = useEventResults(report);
  useEffect(() => { active.current = true; return () => { active.current = false; void session.current?.remove().catch(console.error); }; }, []);
  return <View style={{ gap: 8 }}>
    <Text className="text-foreground">System media controls (external-engine demo)</Text>
    <ActionButton onPress={async () => {
      const next = await createMediaSession({ metadata: { title: "Kitchen Sink", artist: "Spark" }, playbackState: "paused", duration: 120,
        commands: ["play", "pause", "nextTrack", "previousTrack", "seekTo"], onError: log, onCommand: command => {
          log(command);
          if (command.command === "play" || command.command === "pause") void session.current?.update({ playbackState: command.command === "play" ? "playing" : "paused" }).catch(log);
          if (command.position !== undefined) void session.current?.update({ position: command.position }).catch(log);
        } });
      if (!active.current) { await next.remove(); return; }
      session.current = next;
      return "Use system media controls. Commands appear below; this demo publishes controls without playing audio.";
    }}>Publish media session</ActionButton>
    <ActionButton onPress={async () => { await session.current?.remove(); session.current = undefined; }}>Clear media session</ActionButton>
    <EventResults testID="media-session-events" entries={entries} empty="Publish a session, then use system play, pause, next, previous, or seek." />
  </View>;
}
