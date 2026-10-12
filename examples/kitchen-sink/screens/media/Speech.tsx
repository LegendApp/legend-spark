import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button } from "@legendapp/spark/ui/uniwind";
import { PHRASE, useSpeechDemo } from "./speech-demo";
import { useSpeechMessages } from "./speech-messages";

// Test IDs: media-speech-availability and -voices; -speak-normal and -speak-fast speak the phrase, -pause, -resume and
// -stop control it, -spoken shows "<style>: finished | stopped" or an error, -speaking the speaking status, -word the last
// word and -event-<n> the utterance events, newest first. -permissions, -recognizer (read on open and at each Listen) and -request for recognition;
// -listen and -listen-on-device start one, -finish and -cancel end it, -partial and -outcome show what came back.
const ID = "media-speech";

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return <View className="gap-2">
    <Text className="text-base font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    <View className="gap-2 rounded-md border border-border p-3" testID={`${ID}-${id}`}>{children}</View>
  </View>;
}

/** Text to speech with word events, and speech recognition with partial results (@legendapp/spark/speech). */
export function Speech() {
  const t = useSpeechMessages();
  const { availability, voices, speaking, word, events, spoken, permissions, recognizer, partial, outcome, say, control, request, listen, finish } = useSpeechDemo();
  const mono = (id: string, value: string | undefined, fallback: string) => <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-${id}`}>{value ?? fallback}</Text>;
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6" testID={`${ID}-content`}>
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="text-sm text-muted">{t.intro}</Text>
    <Section title={t.availability} id="availability-section">
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-availability`}>{JSON.stringify(availability)}</Text>
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-voices`}>{voices ?? t.reading}</Text>
    </Section>
    <Section title={t.synthesis} id="synthesis">
      <Text selectable className="text-sm text-foreground" testID={`${ID}-phrase`}>{PHRASE}</Text>
      <View className="flex-row flex-wrap gap-2">
        <Button testID={`${ID}-speak-normal`} onPress={() => void say("normal")}>{t.speak}</Button>
        <Button testID={`${ID}-speak-fast`} onPress={() => void say("fast")}>{t.speakFast}</Button>
        <Button testID={`${ID}-pause`} onPress={() => void control("pause")}>{t.pause}</Button>
        <Button testID={`${ID}-resume`} onPress={() => void control("resume")}>{t.resume}</Button>
        <Button testID={`${ID}-stop`} onPress={() => void control("stop")}>{t.stop}</Button>
      </View>
      {mono("spoken", spoken, t.noResult)}
      {mono("speaking", speaking, t.reading)}
      {mono("word", word, t.noResult)}
    </Section>
    <Section title={t.recognition} id="recognition">
      <View className="flex-row flex-wrap gap-2">
        <Button testID={`${ID}-request`} onPress={() => void request()}>{t.request}</Button>
        <Button testID={`${ID}-listen`} onPress={() => void listen(false)}>{t.listen}</Button>
        <Button testID={`${ID}-listen-on-device`} onPress={() => void listen(true)}>{t.listenOnDevice}</Button>
        <Button testID={`${ID}-finish`} onPress={() => void finish("stop")}>{t.finish}</Button>
        <Button testID={`${ID}-cancel`} onPress={() => void finish("cancel")}>{t.cancel}</Button>
      </View>
      {mono("permissions", permissions, t.reading)}
      {mono("recognizer", recognizer, t.reading)}
      {mono("partial", partial, t.noResult)}
      {mono("outcome", outcome, t.noResult)}
      <Text className="text-xs text-muted">{t.driver}</Text>
    </Section>
    <Section title={t.events} id="events">
      {events.length === 0 && <Text className="text-sm text-muted">{t.noEvents}</Text>}
      {events.map(({ key, text }, index) => <Text key={key} selectable className="font-mono text-xs text-foreground" testID={`${ID}-event-${index}`}>{text}</Text>)}
    </Section>
  </ScrollView>;
}
