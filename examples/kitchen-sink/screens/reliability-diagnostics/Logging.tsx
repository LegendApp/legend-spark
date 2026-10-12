import { useCallback, type PropsWithChildren } from "react";
import { ScrollView, Text, View } from "react-native";
import { useI18n } from "../../shell/app-controller";
import { Button } from "../../Controls";
import { DEMO_FILES, loggingAvailability, useLoggingDemo, type DemoId } from "./logging-demo";
import { useLoggingMessages } from "./logging-messages";

// Test IDs: reliability-diagnostics-logging-<demo> runs a demo and -<demo>-result shows its JSON result.
// -file-<n>-name names the nth log file (0 is app.log); -files-summary is {"count","withinLimit"}.
// -entry-<n>-header, -message and -fields show app.log's newest entries, 0 the newest.
const ID = "reliability-diagnostics-logging";
const LEVEL_COLORS: Record<string, string> = { debug: "text-muted", info: "text-foreground", notice: "text-foreground", error: "text-danger", fault: "text-danger" };

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View className="w-80 gap-3">
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </View>;
}

/** Structured logging, rotation and diagnostics export through @legendapp/spark/logging. */
export function Logging() {
  const t = useLoggingMessages();
  const { locale } = useI18n();
  const info = useCallback(() => ({ screen: "reliability-diagnostics/logging", locale }), [locale]);
  const { files, recent, exported, results, errors, run } = useLoggingDemo(info);
  const demo = (id: DemoId, label: string) => <View key={id} className="gap-1">
    <Button testID={`${ID}-${id}`} onPress={() => void run(id)}>{label}</Button>
    <Text selectable numberOfLines={3} className="font-mono text-xs text-muted" testID={`${ID}-${id}-result`}>{results[id] ?? t.noResult}</Text>
  </View>;
  const summary = { count: files.length, withinLimit: files.every(file => file.bytes <= DEMO_FILES.maxFileBytes) };
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="flex-row flex-wrap gap-8 p-6">
    <Section title={t.sections.availability}>
      <View className="gap-1">
        {Object.entries(loggingAvailability()).map(([name, value]) => <Text key={name} selectable className="font-mono text-xs text-muted" testID={`${ID}-availability-${name}`}>{`${name}: ${JSON.stringify(value)}`}</Text>)}
      </View>
      {results.setup && <Text selectable className="font-mono text-xs text-danger" testID={`${ID}-setup-result`}>{results.setup}</Text>}
    </Section>
    <Section title={t.sections.write}>
      <Text className="text-xs text-muted">{t.settings(DEMO_FILES.maxFileBytes, DEMO_FILES.maxFiles)}</Text>
      {demo("write-entries", t.writeEntries)}
      {demo("write-burst", t.writeBurst)}
      {demo("flush", t.flush)}
      {demo("write-failure", t.writeFailure)}
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-error-events`}>{JSON.stringify(errors)}</Text>
    </Section>
    <Section title={t.sections.files}>
      {files.length === 0 && <Text className="text-sm text-muted">{t.noFiles}</Text>}
      {files.map((file, index) => <View key={file.path} className="flex-row justify-between gap-3">
        <Text selectable className="font-mono text-sm text-foreground" testID={`${ID}-file-${index}-name`}>{file.path.split("/").pop()}</Text>
        <Text className="text-sm text-muted">{t.bytes(file.bytes)}</Text>
      </View>)}
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-files-summary`}>{JSON.stringify(summary)}</Text>
      {files[0] && <Text selectable numberOfLines={2} className="font-mono text-xs text-muted" testID={`${ID}-directory`}>{files[0].path.replace(/\/[^/]+$/, "")}</Text>}
    </Section>
    <Section title={t.sections.diagnostics}>
      <Text className="text-xs text-muted">{t.exportHint}</Text>
      {demo("export", t.exportDiagnostics)}
      {exported && <View className="gap-1" testID={`${ID}-exported`}>
        <Text selectable className="font-mono text-sm text-foreground" testID={`${ID}-exported-name`}>{exported.path.split("/").pop()}</Text>
        <Text selectable numberOfLines={2} className="font-mono text-xs text-muted">{exported.path}</Text>
        <Text className="text-sm text-muted">{t.bytes(exported.bytes)}</Text>
      </View>}
    </Section>
    <Section title={t.sections.recent}>
      {recent.length === 0 && <Text className="text-sm text-muted">{t.noEntries}</Text>}
      {recent.map((entry, index) => <View key={`${entry.time}-${index}`} className="gap-0.5" testID={`${ID}-entry-${index}`}>
        <Text className={`font-mono text-xs ${LEVEL_COLORS[entry.level] ?? "text-foreground"}`} testID={`${ID}-entry-${index}-header`}>{`${entry.time.slice(11, 23)} ${entry.level.toUpperCase()} ${entry.category}`}</Text>
        <Text selectable className="text-sm text-foreground" testID={`${ID}-entry-${index}-message`}>{entry.message}</Text>
        {entry.fields !== undefined && <Text selectable numberOfLines={2} className="font-mono text-xs text-muted" testID={`${ID}-entry-${index}-fields`}>{JSON.stringify(entry.fields)}</Text>}
      </View>)}
    </Section>
  </ScrollView>;
}
