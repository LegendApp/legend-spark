import type { PropsWithChildren } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button } from "../../Controls";
import { useDevToolsDemo } from "./devtools-demo";
import { useDevToolsMessages } from "./devtools-messages";
import { FastRefreshMarker } from "./FastRefreshMarker";
import { WORKER } from "../../devtools-tasks";

// Test IDs: devtools-devtools-{availability,shortcut,unavailable,open-shared,open-worker,probe,worker-probe,throw,result}, and
// devtools-devtools-worker-{off,starting,running,failed} for the worker runtime's state.
const ID = "devtools-devtools";

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View className="w-full max-w-3xl gap-2">
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </View>;
}

function Target({ name, status, testID, open, onOpen }: { name: string; status?: { text: string; testID: string }; testID: string; open: string; onOpen(): void }) {
  return <View className="flex-row flex-wrap items-center gap-3 border-b border-border px-4 py-2">
    <Text className="min-w-48 flex-1 text-sm font-semibold text-foreground">{name}</Text>
    {status ? <Text className="text-xs text-muted" testID={status.testID}>{status.text}</Text> : null}
    <Button testID={testID} onPress={onOpen}>{open}</Button>
  </View>;
}

export function DevTools() {
  const t = useDevToolsMessages();
  const { availability, worker, result, open, runProbe, runWorkerProbe, throwUncaught } = useDevToolsDemo(t.opened);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="items-center gap-5 p-6">
    <FastRefreshMarker />
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="max-w-3xl text-center text-sm text-muted">{t.intro}</Text>
    <Section title={t.sections.availability}>
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-availability`}>{JSON.stringify(availability)}</Text>
      <Text className="text-sm text-foreground" testID={availability.available ? `${ID}-shortcut` : `${ID}-unavailable`}>{availability.available ? t.shortcut : t.unavailable}</Text>
    </Section>
    {availability.available ? <>
      <Section title={t.sections.targets}>
        <View className="overflow-hidden rounded-lg border border-border bg-surface">
          <Target name={t.shared} testID={`${ID}-open-shared`} open={t.open} onOpen={() => void open("shared")} />
          <Target name={t.worker(WORKER)} status={{ testID: `${ID}-worker-${worker.status}`, text: worker.status === "failed" ? `${t.workerStatus.failed}: ${worker.error}` : t.workerStatus[worker.status] }} testID={`${ID}-open-worker`} open={t.open} onOpen={() => void open({ isolated: WORKER })} />
        </View>
      </Section>
      <Section title={t.sections.tryIt}>
        <Text className="text-sm text-muted">{t.steps}</Text>
        <View className="flex-row flex-wrap gap-2">
          <Button testID={`${ID}-probe`} onPress={runProbe}>{t.runProbe}</Button>
          <Button testID={`${ID}-worker-probe`} disabled={worker.status !== "running"} onPress={() => void runWorkerProbe()}>{t.runWorkerProbe}</Button>
          <Button testID={`${ID}-throw`} onPress={throwUncaught}>{t.throwUncaught}</Button>
        </View>
      </Section>
      <Section title={t.sections.result}>
        <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-result`}>{result ?? t.noResult}</Text>
      </Section>
    </> : null}
  </ScrollView>;
}
