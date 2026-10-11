import type { PropsWithChildren } from "react";
import { ScrollView, Text, View } from "react-native";
import { SegmentedControl } from "@legendapp/spark/ui/uniwind";
import { useI18n } from "../../shell/app-controller";
import { Button } from "../../Controls";
import { availabilityText, BLOCKS, frameText, THRESHOLDS, useHangWatchdogDemo, type Threshold } from "./hang-watchdog-demo";
import { useHangWatchdogMessages } from "./hang-watchdog-messages";

// Test IDs: <ID>-availability and <ID>-state ("starting", "watching <ms>", "stopped" or SparkError:<code>);
// <ID>-toggle starts or stops the watchdog; <ID>-block-<ms> blocks the main thread, then <ID>-block-result
// reads "blocked <ms>"; <ID>-count counts reports, <ID>-report-<n> is the nth newest; <ID>-simulated
// holds the JSON check of the latest report caused by a block.
const ID = "reliability-diagnostics-hang-watchdog";
const FRAMES = 8;

function Section({ title, wide, children }: PropsWithChildren<{ title: string; wide?: boolean }>) {
  return <View className={wide ? "w-full gap-3" : "w-80 gap-3"}>
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </View>;
}

/** Main-thread hang reports with stacks, through @legendapp/spark/diagnostics. */
export function HangWatchdog() {
  const t = useHangWatchdogMessages();
  const { locale } = useI18n();
  const demo = useHangWatchdogDemo();
  const mono = "font-mono text-xs text-muted";
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="flex-row flex-wrap gap-8 p-6">
    <Section title={t.sections.watchdog}>
      <Text className="text-xs text-muted">{t.intro}</Text>
      <Text selectable className={mono} testID={`${ID}-availability`}>{availabilityText()}</Text>
      <Text className="text-xs text-foreground">{t.threshold}</Text>
      <SegmentedControl testID={`${ID}-threshold`} accessibilityLabel={t.threshold} options={THRESHOLDS.map(ms => ({ label: t.thresholdOption(ms), value: String(ms) }))}
        value={String(demo.thresholdMs)} onValueChange={value => demo.setThreshold(Number(value) as Threshold)} />
      <Button testID={`${ID}-toggle`} onPress={() => demo.setWatching(!demo.watching)}>{demo.watching ? t.stop : t.start}</Button>
      <Text selectable className={mono} testID={`${ID}-state`}>{demo.state}</Text>
    </Section>
    <Section title={t.sections.block}>
      <Text className="text-xs text-muted">{t.blockHint}</Text>
      {BLOCKS.map(ms => <Button key={ms} testID={`${ID}-block-${ms}`} disabled={demo.blocking !== undefined} onPress={() => void demo.block(ms)}>{t.block(ms)}</Button>)}
      <Text selectable className={mono} testID={`${ID}-block-result`}>{demo.blocking !== undefined ? t.blocking(demo.blocking) : demo.blockResult ?? "—"}</Text>
    </Section>
    <Section title={t.sections.reports} wide>
      <Text className="text-sm text-foreground" testID={`${ID}-count`}>{t.count(demo.reports.length)}</Text>
      <Button testID={`${ID}-clear`} onPress={demo.clear}>{t.clear}</Button>
      {demo.simulated && <View className="gap-1">
        <Text className="text-xs text-foreground">{t.simulated}</Text>
        <Text selectable className={mono} testID={`${ID}-simulated`}>{demo.simulated}</Text>
      </View>}
      {demo.reports.length === 0 && <Text className="text-xs text-muted">{t.none}</Text>}
      {demo.reports.map((report, index) => <View key={`${report.startedAt}-${index}`} className="gap-1 rounded-md border border-border p-3" testID={`${ID}-report-${index + 1}`}>
        <Text className="text-sm text-foreground">{t.report(demo.reports.length - index, report.durationMs, report.thresholdMs, new Date(report.startedAt).toLocaleTimeString(locale))}</Text>
        {/* Stacks read left to right in every locale, as in a crash log. */}
        <View style={{ direction: "ltr" }}>
          {report.stack.slice(0, FRAMES).map((frame, depth) => <Text key={depth} selectable numberOfLines={1} className={mono}>{`${depth}  ${frameText(frame)}`}</Text>)}
          {report.stack.length > FRAMES && <Text className={mono}>{`… ${report.stack.length - FRAMES}`}</Text>}
        </View>
      </View>)}
    </Section>
  </ScrollView>;
}
