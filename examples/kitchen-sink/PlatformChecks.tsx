import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, ScrollView, Text, View, TurboModuleRegistry, type TurboModule } from "react-native";
import { Button, TextInput, Select } from "@legendapp/spark/ui";
import * as Clipboard from "@legendapp/spark/clipboard";
import * as Storage from "@legendapp/spark/secure-storage";
import * as Linking from "@legendapp/spark/links";
import { clipboardRead, clipboardRoundTrip, secureStorageLifecycle, linkingResolution, assertContract } from "./contract-cases";
import { catalog, executeCase, initialResults, updateResult, summarize, type CaseResult, type TestPlatform } from "./contract-report";
import { runDesktopContracts } from "./desktop-contracts";
import DesktopLibraryChecks from "./DesktopLibraryChecks";
import DesktopInteractionChecks from "./DesktopInteractionChecks";
import { testConfig } from "./platform-test-config";
const options = [{ label: "First", value: "first" }, { label: "Second", value: "second" }];
interface RuntimeModule extends TurboModule { call(method: string, args: string): Promise<string> }
const platform = Platform.OS as TestPlatform;
const runtimeModule = platform === "macos" || platform === "windows" ? TurboModuleRegistry.get<RuntimeModule>("NativeDesktopApp") : null;
// Kept outside React: native work and reporting never depend on a render completing.
async function runtimeIdentity() {
  return { platform, hermes: !!(globalThis as any).HermesInternal,
    native: runtimeModule ? JSON.parse(await runtimeModule.call("context", "{}")).runtime : null,
    reactNativeVersion: Platform.constants?.reactNativeVersion };
}
export default function PlatformChecks({ windowId }: { windowId?: string } = {}) {
  if (windowId && windowId !== "main") return <View style={{ padding: 24, gap: 12 }}>
    <Text>Window: {windowId}</Text><Text>This window participates in the main window's acceptance run.</Text>
    <Button onPress={() => { void TurboModuleRegistry.get<RuntimeModule>("NativeDesktopWindowManager")?.call("close", JSON.stringify({ id: windowId })); }}>Close this window</Button>
  </View>;
  return <MainChecks />;
}
function MainChecks() {
  const results = useRef(initialResults(platform));
  const started = useRef(false);
  const [visible, setVisible] = useState(results.current);
  const [running, setRunning] = useState(false);
  const [libraryInteraction, setLibraryInteraction] = useState(false);
  const [nativeInteraction, setNativeInteraction] = useState(false);
  const [value, setValue] = useState("first");
  const [delivery, setDelivery] = useState("Waiting for test execution");
  const publish = useCallback(async (complete = false) => {
    if (!testConfig.reportURL) return;
    const response = await fetch(testConfig.reportURL, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: testConfig.runId, complete, runtime: await runtimeIdentity(), results: results.current }) });
    if (!response.ok) throw new Error(`Report rejected: HTTP ${response.status}`);
    setDelivery(complete ? "Results saved. You can close this app." : "Results saved; unexecuted cases remain visible.");
  }, []);
  const save = useCallback((result: CaseResult) => {
    results.current = updateResult(results.current, result); setVisible(results.current);
  }, []);
  const check = useCallback(async (id: string, action: () => Promise<void>) => { save(await executeCase(id, action)); await publish(); }, [publish, save]);
  function interaction(id: string) {
    save({ id, status: "passed", evidence: "Observed React callback after UI interaction" });
    void publish().catch(error => setDelivery(String(error)));
  }
  const run = useCallback(async () => {
    setRunning(true);
    try {
      if (platform === "web") {
        for (const id of ["clipboard.read", "clipboard.roundtrip"]) save({ id, status: "not-tested", detail: "Browser clipboard requires an interactive permission/gesture check; use the clipboard button." });
        await check("storage.unavailable", async () => {
          assertContract(!await Storage.isAvailableAsync(), "Web must not claim secure storage");
          try { await Storage.getItemAsync("unavailable-probe"); }
          catch (error) { assertContract((error as { code?: string }).code === "E_UNSUPPORTED_PLATFORM", "Unexpected unavailable error"); return; }
          throw new Error("Unavailable storage returned a value");
        });
      } else {
        await check("clipboard.read", () => clipboardRead(Clipboard));
        // Only text is restored by this common case; use a disposable test session.
        await check("clipboard.roundtrip", () => clipboardRoundTrip(Clipboard, testConfig.runId));
        await check("storage.lifecycle", () => secureStorageLifecycle(Storage, `contract-${testConfig.runId}`));
      }
      await check("links.resolution", () => linkingResolution(Linking));
      await runDesktopContracts(check, testConfig.runId);
      await publish(testConfig.apiOnly);
    } finally { setRunning(false); }
  }, [check, publish, save]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (started.current) return;
      started.current = true;
      void run().catch(error => setDelivery(String(error)));
    }, 100);
    return () => clearTimeout(timer);
  }, [run]);
  const summary = summarize(visible);
  return <ScrollView contentContainerStyle={{ padding: 24, gap: 12 }}>
    <Text accessibilityRole="header" style={{ fontSize: 24 }}>Platform acceptance: {platform}</Text>
    <Text>Press the native button, enter “Native edit”, and select “Second”. Then finish the run. Untested cases will stay untested.</Text>
    <View style={{ gap: 12 }}>
      <Button testID="spark-button" onPress={() => interaction("ui.button")}>Native button</Button>
      <TextInput testID="spark-input" accessibilityLabel="Test input" defaultValue="Initial" onChangeText={text => { if (text === "Native edit") interaction("ui.input"); }} />
      <Select testID="spark-select" accessibilityLabel="Test selection" options={options} value={value} onValueChange={next => { setValue(next); if (next === "second") interaction("ui.select"); }} />
      {platform === "web" && <Button disabled={running} onPress={() => {
        setRunning(true);
        void check("clipboard.roundtrip", () => clipboardRoundTrip(Clipboard, testConfig.runId))
          .then(() => publish()).catch(error => setDelivery(String(error))).finally(() => setRunning(false));
      }}>Check clipboard</Button>}
      <DesktopLibraryChecks check={check} onError={setDelivery} onBusy={setLibraryInteraction} />
      <DesktopInteractionChecks check={check} onError={setDelivery} onBusy={setNativeInteraction} />
      <Button disabled={running || nativeInteraction || libraryInteraction} onPress={() => void publish(true).catch(error => setDelivery(String(error)))}>Finish run</Button>
    </View>
    <Text>{delivery}</Text>
    <Text>{Object.entries(summary.counts).map(([status, count]) => `${count} ${status}`).join(" · ")}</Text>
    {visible.map(result => <Text key={result.id} testID={`result-${result.id}`}>
      {result.status}: {catalog.find(c => c.id === result.id)!.title}{result.detail ? ` — ${result.detail}` : ""}
    </Text>)}
  </ScrollView>;
}
