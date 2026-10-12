import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button } from "@legendapp/spark/ui/uniwind";
import { VideoView } from "@legendapp/spark/video";
import { useVideoDemo, type VideoAction } from "./video-demo";
import { useVideoMessages } from "./video-messages";

// Test IDs: media-video-availability and -pip-availability; -view shows the player; -status is the player's status
// ("paused · 0.00/3.00 s · …"); -<action> runs a command and -result shows "<action>: done" or its error; -event-<n>
// lists events, newest first (timeUpdate only moves the status).
const ID = "media-video";
const PLAYBACK: readonly VideoAction[] = ["play", "pause", "seek", "nearEnd", "rate", "volume", "mute"];
const WINDOW: readonly VideoAction[] = ["enterFullscreen", "exitFullscreen", "startPip", "stopPip"];

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return <View className="gap-2">
    <Text className="text-base font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    <View className="gap-2 rounded-md border border-border p-3" testID={`${ID}-${id}`}>{children}</View>
  </View>;
}

/** Playback, status events, fullscreen and picture in picture of the silent test clip (@legendapp/spark/video). */
export function Video() {
  const t = useVideoMessages();
  const { availability, pictureInPicture, player, status, events, result, run } = useVideoDemo();
  const actions = (list: readonly VideoAction[]) => <View className="flex-row flex-wrap gap-2">
    {list.map(action => <Button key={action} testID={`${ID}-${action}`} onPress={() => void run(action)}>{t.actions[action]}</Button>)}
  </View>;
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6" testID={`${ID}-content`}>
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="text-sm text-muted">{t.intro}</Text>
    <Section title={t.availability} id="availability-section">
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-availability`}>{JSON.stringify(availability)}</Text>
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-pip-availability`}>{pictureInPicture ? JSON.stringify(pictureInPicture) : t.loading}</Text>
    </Section>
    <Section title={t.playback} id="playback">
      {availability.available && <VideoView player={player} testID={`${ID}-view`} accessibilityLabel={t.videoLabel} style={{ width: 320, height: 180, backgroundColor: "black" }} />}
      <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-status`}>{status ?? t.loading}</Text>
      {actions(PLAYBACK)}
      <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-result`}>{result ?? t.noResult}</Text>
    </Section>
    <Section title={t.window} id="window">
      {actions(WINDOW)}
      <Text className="text-xs text-muted">{t.driver}</Text>
    </Section>
    <Section title={t.events} id="events">
      {events.length === 0 && <Text className="text-sm text-muted">{t.noEvents}</Text>}
      {events.map(({ key, text }, index) => <Text key={key} selectable className="font-mono text-xs text-foreground" testID={`${ID}-event-${index}`}>{text}</Text>)}
    </Section>
  </ScrollView>;
}
