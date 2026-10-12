import type { PropsWithChildren } from "react";
import { ScrollView, Text, View } from "react-native";
import { MotionView } from "@legendapp/spark/motion";
import { Button } from "../../Controls";
import { TRACK, useProfilingDemo } from "./profiling-demo";
import { useProfilingMessages } from "./profiling-messages";

// Test IDs: devtools-profiling-{availability,available,unavailable,start,stop,workload,worker-workload,animate,box,
// allocate,result}, devtools-profiling-recording-{idle,recording,saved,failed} and devtools-profiling-worker-<status>.
const ID = "devtools-profiling";

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View className="w-full max-w-3xl gap-2">
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </View>;
}

export function Profiling() {
  const t = useProfilingMessages();
  const demo = useProfilingDemo();
  const { availability, worker, recording } = demo;
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 p-6">
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="max-w-3xl text-sm text-muted">{t.intro}</Text>
    <Section title={t.sections.availability}>
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-availability`}>{JSON.stringify(availability)}</Text>
      <Text className="text-sm text-foreground" testID={availability.available ? `${ID}-available` : `${ID}-unavailable`}>{availability.available ? t.available : t.unavailable}</Text>
    </Section>
    {availability.available ? <>
      <Section title={t.sections.record}>
        <Text className="text-sm text-muted">{t.recordHint}</Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <Button testID={`${ID}-start`} disabled={recording === "recording"} onPress={() => void demo.start()}>{t.start}</Button>
          <Button testID={`${ID}-stop`} disabled={recording !== "recording"} onPress={() => void demo.stop()}>{t.stop}</Button>
          <Text className="text-sm text-foreground" testID={`${ID}-recording-${recording}`}>{t.recording[recording]}</Text>
        </View>
      </Section>
      <Section title={t.sections.workloads}>
        <View className="flex-row flex-wrap items-center gap-2">
          <Button testID={`${ID}-workload`} onPress={() => void demo.workload()}>{t.workload}</Button>
          <Button testID={`${ID}-worker-workload`} disabled={worker.status !== "running"} onPress={() => void demo.workerWorkload()}>{t.workerWorkload}</Button>
          <Text className="text-xs text-muted" testID={`${ID}-worker-${worker.status}`}>{t.worker[worker.status]}</Text>
        </View>
        <View className="flex-row flex-wrap items-center gap-3">
          <Button testID={`${ID}-animate`} onPress={() => void demo.animate()}>{t.animate}</Button>
          <View className="h-10 justify-center rounded-md bg-surface" style={{ width: TRACK + 44, paddingStart: 4 }}>
            <MotionView ref={demo.box} testID={`${ID}-box`} style={{ width: 36, height: 28 }}>
              <View className="flex-1 rounded-md bg-success" />
            </MotionView>
          </View>
        </View>
      </Section>
      <Section title={t.sections.heap}>
        <Text className="text-sm text-muted">{t.heap}</Text>
        <Button testID={`${ID}-allocate`} onPress={() => void demo.allocate()}>{t.allocate}</Button>
      </Section>
      <Section title={t.sections.result}>
        <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-result`}>{demo.result ?? t.noResult}</Text>
      </Section>
    </> : null}
  </ScrollView>;
}
