import { Button } from "./Controls";
import React, { useEffect, useState, type ReactElement } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import * as app from "@legendapp/spark/app";
import * as windows from "@legendapp/spark/windows";
import * as files from "@legendapp/spark/files";
import { AuthChecks } from "./AuthChecks";
import { AudioChecks } from "./AudioChecks";
import { FileStreamChecks } from "./FileStreamChecks";
import { FoundationChecks } from "./FoundationChecks";
import { runSidecarChecks } from "./sidecar-checks";
import { runChecks, type Check } from "./checks";
import { APIChecks } from "./APIChecks";
import { NativeControls } from "./NativeControls";
import { ExpansionChecks } from "./ExpansionChecks";
import { Shell } from "./shell/Shell";
import { testDriver } from "./test-driver";
import { argument, reportLaunch, type ReportFlag } from "./launch";

type Props = Partial<app.AppContext> & { windowId?: string; windowProps?: { overlay?: boolean; message?: string; readyFile?: string } };
const reports: Record<ReportFlag, (report: string, args: readonly string[]) => ReactElement> = {
  "--spark-auth-report": (report, args) => <AuthChecks report={report} provider={argument(args, "--spark-auth-provider")!} />,
  "--spark-audio-report": (report, args) => <AudioChecks report={report} source={argument(args, "--spark-audio-source")!} />,
  "--spark-files-report": report => <FileStreamChecks report={report} />,
  "--spark-foundation-report": report => <FoundationChecks report={report} />,
  "--spark-ui-report": report => <NativeControls report={report} />,
  "--spark-api-report": (report, args) => <APIChecks report={report} expectedInitial={argument(args, "--spark-api-initial") ?? null} />,
  "--spark-expansion-report": report => <ExpansionChecks report={report} />,
  "--spark-test-report": (report, args) => <AutomatedChecks report={report} args={args} />,
};
export default function App(props: Props) {
  const args = props.launchArguments ?? [];
  if (props.windowId && props.windowId !== "main") return <SecondaryWindow {...props} />;
  const launch = reportLaunch(args);
  if (launch) return reports[launch.flag](launch.report, args);
  return <Shell mode={props.runtime?.mode} projectId={props.projectId} />;
}
function SecondaryWindow(props: Props) {
  useEffect(() => {
    const file = props.windowProps?.readyFile;
    if (file) void files.writeText(file, props.windowProps?.message ?? "").catch(console.error);
    return () => { if (file) void files.writeText(`${file}.closed`, "unmounted").catch(console.error); };
  }, [props.windowProps?.readyFile, props.windowProps?.message]);
  if (props.windowProps?.overlay) return <View style={{ flex: 1, padding: 12, backgroundColor: "transparent" }}>
    <View style={{ borderRadius: 12, padding: 12, gap: 8 }} className="bg-background">
      <Text className="text-foreground">Overlay — keyboard focus stays in your app</Text>
      <Button onPress={() => void windows.closeWindow(props.windowId!).catch(console.error)}>Close overlay</Button>
    </View>
  </View>;
  return <View style={styles.root} className="bg-background" testID="secondary-window">
    <Text style={styles.title} className="text-foreground">Secondary window</Text><Text className="text-muted">{props.windowProps?.message ?? props.windowId}</Text>
    <Button onPress={() => void windows.closeWindow(props.windowId!).catch(console.error)}>Close this window</Button>
  </View>;
}
function AutomatedChecks({ report, args }: { report: string; args: readonly string[] }) {
  const [checks, setChecks] = useState<Check[]>([]);
  useEffect(() => {
    let started = false;
    // Let the main React window mount before opening secondary roots.
    const timer = setTimeout(() => {
      if (started) return; started = true;
      void (args.includes("--spark-sidecar-probe") ? runSidecarChecks() : runChecks(async result => { setChecks(previous => [...previous, result]); await files.writeText(`${report}.progress`, JSON.stringify(result)); }, testDriver, argument(args, "--spark-isolation-expect") ? { expect: argument(args, "--spark-isolation-expect") as "absent" | "present", cleanup: args.includes("--spark-isolation-cleanup") } : undefined))
        .then(async result => {
          await files.writeText(report, JSON.stringify(result, null, 2));
          if (args.includes("--spark-test-quit-on-complete")) { await new Promise(resolve => setTimeout(resolve, 2500)); await app.beforeQuit(() => true); await app.quit(); }
        })
        .catch(error => files.writeText(report, JSON.stringify({ passed: false, error: String(error), results: [] })));
    }, 500);
    return () => clearTimeout(timer);
  }, [report, args]);
  return <ScrollView style={styles.root} className="bg-background" testID="automated-checks"><Text style={styles.title} className="text-foreground">Native SDK checks</Text>{checks.map(check => <Text key={check.name} className="text-muted">{check.passed ? "PASS" : "FAIL"} {check.name} {check.error}</Text>)}</ScrollView>;
}
const styles = StyleSheet.create({ root: { flex: 1, padding: 24, gap: 16 }, title: { fontSize: 28, fontWeight: "700" } });
