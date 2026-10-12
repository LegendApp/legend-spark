import type { PropsWithChildren } from "react";
import { ScrollView, Text, View } from "react-native";
import type { CrashReport } from "@legendapp/spark/diagnostics";
import { useI18n } from "../../shell/app-controller";
import { Button } from "../../Controls";
import { availabilityText, KINDS, useCrashReportingDemo } from "./crash-reporting-demo";
import { useCrashReportingMessages } from "./crash-reporting-messages";
import { frameText } from "./hang-watchdog-demo";

// Test IDs: <ID>-availability; <ID>-state ("consent on", "consent off" or SparkError:<code>); <ID>-consent toggles
// consent; <ID>-simulate-<kind> crashes, then <ID>-result holds the JSON check of its report or SparkError:<code>;
// <ID>-count counts reports, <ID>-delete deletes them all, <ID>-report-<n> is the nth newest.
const ID = "reliability-diagnostics-crash-reporting";
const FRAMES = 8;

function Section({ title, wide, children }: PropsWithChildren<{ title: string; wide?: boolean }>) {
  return <View className={wide ? "w-full gap-3" : "w-80 gap-3"}>
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </View>;
}

/** The report's headline as a crash log would put it: the signal and exception, or the JavaScript error. */
const headline = (report: CrashReport) => report.kind === "native"
  ? [report.signal, report.exception && `${report.exception.name}: ${report.exception.reason}`].filter(Boolean).join(" · ")
  : `${report.name}: ${report.message}`;
// A JavaScript stack starts with the headline again; only its frames are shown.
const stackLines = (report: CrashReport) => report.kind === "native"
  ? report.stack.map((frame, depth) => `${depth}  ${frameText(frame)}`)
  : (report.stack ?? "").split("\n").filter(line => line && line !== headline(report)).map(line => line.trim());

/** Native and JavaScript crash reports with consent, through @legendapp/spark/diagnostics. */
export function CrashReporting() {
  const t = useCrashReportingMessages();
  const { locale } = useI18n();
  const demo = useCrashReportingDemo();
  const mono = "font-mono text-xs text-muted";
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="flex-row flex-wrap gap-8 p-6">
    <Section title={t.sections.consent}>
      <Text className="text-xs text-muted">{t.intro}</Text>
      <Text selectable className={mono} testID={`${ID}-availability`}>{availabilityText()}</Text>
      <Button testID={`${ID}-consent`} disabled={demo.consent === undefined} onPress={() => void demo.toggleConsent()}>{demo.consent ? t.revoke : t.grant}</Button>
      <Text selectable className={mono} testID={`${ID}-state`}>{demo.state}</Text>
    </Section>
    <Section title={t.sections.simulate}>
      <Text className="text-xs text-muted">{t.simulateHint}</Text>
      {KINDS.map(kind => <Button key={kind} testID={`${ID}-simulate-${kind}`} disabled={demo.busy !== undefined} onPress={() => void demo.simulate(kind)}>{t.kind[kind]}</Button>)}
      <Text selectable className={mono} testID={`${ID}-result`}>{demo.busy ? t.crashing : demo.result ?? "—"}</Text>
    </Section>
    <Section title={t.sections.reports} wide>
      <Text className="text-sm text-foreground" testID={`${ID}-count`}>{t.count(demo.reports.length)}</Text>
      <Button testID={`${ID}-delete`} onPress={() => void demo.deleteAll()}>{t.deleteAll}</Button>
      {demo.reports.length === 0 && <Text className="text-xs text-muted">{t.none}</Text>}
      {demo.reports.map((report, index) => {
        const lines = stackLines(report);
        return <View key={report.id} className="gap-1 rounded-md border border-border p-3" testID={`${ID}-report-${index + 1}`}>
          <Text className="text-sm text-foreground">{`${new Date(report.createdAt).toLocaleString(locale)} · ${report.kind}${report.simulated ? ` · ${t.simulatedTag}` : ""}`}</Text>
          {/* Crash details read left to right in every locale, as in a crash log. */}
          <View style={{ direction: "ltr" }}>
            <Text selectable className="font-mono text-xs text-foreground">{headline(report)}</Text>
            {lines.slice(0, FRAMES).map((line, depth) => <Text key={depth} selectable numberOfLines={1} className={mono}>{line}</Text>)}
            {lines.length > FRAMES && <Text className={mono}>{`… ${lines.length - FRAMES}`}</Text>}
          </View>
        </View>;
      })}
    </Section>
  </ScrollView>;
}
