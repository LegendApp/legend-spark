import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button } from "../../Controls";
import { useLifecycleMessages } from "./lifecycle-messages";
import { useAppLifecycle, type RelaunchStatus } from "./useAppLifecycle";

// Test IDs: app-lifecycle-launch-<field>. Values are what @legendapp/spark/app reports.
const ID = "app-lifecycle-launch";

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return <View className="flex-row flex-wrap gap-x-3 gap-y-1">
    <Text className="w-40 text-sm text-muted">{label}</Text>
    <Text selectable className="flex-1 text-sm text-foreground" testID={`${ID}-${id}`}>{children}</Text>
  </View>;
}

/** Single-instance status, forwarded second launches, relaunch (with an optional quit veto) and safe mode. */
export function LaunchInstance() {
  const t = useLifecycleMessages();
  const { availability, context, error, launches, vetoQuit, setVetoQuit, status, relaunch } = useAppLifecycle();
  const statusText = (value: RelaunchStatus) => value === "idle" ? undefined : typeof value === "object" ? `${t.failed} ${value.error}` : t[value];
  const list = (items: readonly string[]) => items.length ? items.join("\n") : t.none;
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6" testID={`${ID}-content`}>
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="text-sm text-muted">{t.intro}</Text>
    <View className="gap-2 rounded-md border border-border p-3">
      <Field label={t.availability} id="availability">{JSON.stringify(availability)}</Field>
      {context ? <>
        <Field label={t.instance} id="instance">{t.instanceValue[context.launch.instance]}</Field>
        <Field label={t.safeMode} id="safe-mode">{t.safeModeValue[context.launch.safeMode ?? "off"]}</Field>
        <Field label={t.relaunched} id="relaunched">{context.launch.relaunched ? t.yes : t.no}</Field>
        <Field label={t.arguments} id="arguments">{list(context.launchArguments.slice(1))}</Field>
      </> : !error && <Text className="text-sm text-muted">{t.loading}</Text>}
      {error && <Text selectable className="text-sm text-danger" testID={`${ID}-error`}>{error}</Text>}
    </View>
    <Text className="text-sm text-muted">{t.safeModeHint}</Text>
    <View className="flex-row flex-wrap gap-3">
      <Button testID={`${ID}-relaunch`} disabled={status === "pending"} onPress={() => void relaunch("same")}>{t.relaunch}</Button>
      <Button testID={`${ID}-relaunch-safe`} disabled={status === "pending"} onPress={() => void relaunch("safe")}>{t.relaunchSafe}</Button>
      <Button testID={`${ID}-relaunch-normal`} disabled={status === "pending"} onPress={() => void relaunch("normal")}>{t.relaunchNormal}</Button>
      <Button testID={`${ID}-veto`} onPress={() => setVetoQuit(!vetoQuit)}>{vetoQuit ? t.allowQuit : t.vetoQuit}</Button>
    </View>
    {statusText(status) && <Text selectable className="text-sm text-foreground" testID={`${ID}-status`}>{statusText(status)}</Text>}
    <Text className="text-base font-semibold text-foreground" accessibilityRole="header">{t.secondLaunches}</Text>
    <View className="gap-3" testID={`${ID}-second-launches`}>
      {launches.length === 0 && <Text className="text-sm text-muted" testID={`${ID}-no-launches`}>{t.noLaunches}</Text>}
      {launches.map((launch, index) => <View key={launch.key} className="gap-1 rounded-md border border-border p-3" testID={`${ID}-second-launch-${index}`}>
        <Field label={t.arguments} id={`second-launch-${index}-arguments`}>{list(launch.arguments.slice(1))}</Field>
        <Field label={t.workingDirectory} id={`second-launch-${index}-directory`}>{launch.workingDirectory}</Field>
        <Field label={t.files} id={`second-launch-${index}-files`}>{list(launch.files)}</Field>
        <Field label={t.urls} id={`second-launch-${index}-urls`}>{list(launch.urls)}</Field>
      </View>)}
    </View>
  </ScrollView>;
}
