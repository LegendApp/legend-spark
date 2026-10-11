import type { PropsWithChildren } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button } from "../../Controls";
import { useDockTaskbarDemo, type DemoId } from "./dock-taskbar-demo";
import { useDockTaskbarMessages } from "./dock-taskbar-messages";

// Test IDs: system-integration-dock-<demo> runs a demo and system-integration-dock-<demo>-result shows
// its result; system-integration-dock-availability-<feature> shows getSystemAvailability(feature).
const ID = "system-integration-dock";

function Section({ title, hint, children }: PropsWithChildren<{ title: string; hint?: string }>) {
  return <View className="w-80 gap-3">
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {hint && <Text className="text-xs text-muted">{hint}</Text>}
    {children}
  </View>;
}

/** Dock and taskbar badge, progress, attention, launcher menus and the thumbnail toolbar through @legendapp/spark/system. */
export function DockTaskbar() {
  const t = useDockTaskbarMessages();
  const { availability, results, lastAction, run } = useDockTaskbarDemo(t);
  const demo = (id: DemoId, label: string) => <View key={id} className="gap-1">
    <Button testID={`${ID}-${id}`} onPress={() => void run(id)}>{label}</Button>
    <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-${id}-result`}>{results[id] ?? t.noResult}</Text>
  </View>;
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="flex-row flex-wrap gap-8 p-6">
    <Section title={t.sections.availability}>
      <View className="gap-1">
        {Object.entries(availability).map(([name, value]) => <Text key={name} selectable className="font-mono text-xs text-muted" testID={`${ID}-availability-${name}`}>{`${name}: ${JSON.stringify(value)}`}</Text>)}
      </View>
    </Section>
    <Section title={t.sections.badge} hint={t.hints.badge}>
      {demo("badge-text", t.setBadgeText)}
      {demo("badge-count", t.setBadgeCount)}
      {demo("badge-large", t.setBadgeLarge)}
      {demo("badge-clear", t.clearBadge)}
    </Section>
    <Section title={t.sections.progress} hint={t.hints.progress}>
      {demo("progress-35", t.progress35)}
      {demo("progress-indeterminate", t.progressIndeterminate)}
      {demo("progress-paused", t.progressPaused)}
      {demo("progress-error", t.progressError)}
      {demo("progress-invalid", t.progressInvalid)}
      {demo("progress-clear", t.clearProgress)}
    </Section>
    <Section title={t.sections.attention} hint={t.hints.attention}>
      {demo("attention-informational", t.attentionInformational)}
      {demo("attention-critical", t.attentionCritical)}
      {demo("attention-stop", t.stopAttention)}
    </Section>
    <Section title={t.sections.launcher} hint={t.hints.launcher}>
      {demo("launcher-install", t.installLauncher)}
      {demo("launcher-remove", t.removeLauncher)}
      <Text selectable className="text-sm text-foreground" testID={`${ID}-last-action`}>{`${t.lastAction}: ${lastAction ?? t.noResult}`}</Text>
    </Section>
    <Section title={t.sections.thumbnail} hint={t.hints.thumbnail}>
      {demo("thumbnail", t.addThumbnail)}
    </Section>
  </ScrollView>;
}
