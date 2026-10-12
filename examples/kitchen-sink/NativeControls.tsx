import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, TextInput, Select } from "@legendapp/spark/ui";
import { writeText } from "@legendapp/spark/files";
import { quit } from "@legendapp/spark/app";
import { sdkTestDriver } from "./sdk-test-driver";

export function NativeControls({ report }: { report?: string }) {
  const [count, setCount] = useState(0);
  const [disabled, setDisabled] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [name, setName] = useState("Initial name");
  const [choice, setChoice] = useState("first");
  const options = generation % 2 ? reversedOptions : initialOptions;
  const snapshot = useRef({ count, generation, name, choice });
  useEffect(() => { snapshot.current = { count, generation, name, choice }; }, [count, generation, name, choice]);
  useEffect(() => {
    if (!report) return;
    const timer = setTimeout(() => {
      void runNativeButtonChecks(() => snapshot.current)
        .then(results => writeText(report, JSON.stringify({ passed: true, results })))
        .catch(error => writeText(report, JSON.stringify({ passed: false, error: String(error) })))
        .then(() => quit()).catch(console.error);
    }, 500);
    return () => clearTimeout(timer);
  }, [report]);
  return <View style={styles.container}>
    <Text style={styles.text} className="text-muted" testID="native-button-count">Native button presses: {count}</Text>
    <View style={styles.row}>
      <Button key={generation} testID="native-button-increment" disabled={disabled}
        onPress={() => setCount(value => value + 1)}>Increment natively</Button>
      <Button testID="native-button-toggle" onPress={() => setDisabled(value => !value)}>
        {disabled ? "Enable increment" : "Disable increment"}
      </Button>
      <Button variant="borderless" testID="native-button-remount"
        onPress={() => setGeneration(value => value + 1)}>Remount button</Button>
    </View>
    <TextInput testID="native-field" accessibilityLabel="Name" defaultValue={generation ? "New default" : "Initial name"} onChangeText={setName} />
    <Select testID="native-select" accessibilityLabel="Choice" options={options} value={choice} onValueChange={setChoice} />
    <Text style={styles.text} className="text-muted" testID="native-button-generation">Button remounts: {generation}</Text>
    <Text style={styles.text} className="text-muted">Name: {name}; choice: {choice}</Text>
    <Text style={styles.text} className="text-muted">AppKit buttons with native focus and activation. Remount preserves the disabled state and application counter.</Text>
  </View>;
}

const initialOptions = [{ label: "Same label", value: "first" }, { label: "Same label", value: "second" }];
const reversedOptions = [...initialOptions].reverse();
async function runNativeButtonChecks(snapshot: () => { count: number; generation: number; name: string; choice: string }) {
  const driver = sdkTestDriver;
  if (!driver) throw new Error("Native button checks require the test-only driver");
  const call = async (method: string, id: string) => JSON.parse(await driver.call(method, JSON.stringify({ id })));
  const state = () => call("buttonState", "native-button-increment");
  const click = (id: string) => call("buttonClick", `native-button-${id}`);
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const wait = async (predicate: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 100; i++) {
      try { if (await predicate()) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error("Native button update timed out");
  };
  await wait(async () => !!(await state()).native);
  const mounted = await state();
  assert(mounted.enabled && mounted.width > 0 && mounted.height > 0 && mounted.hit, "Button must own a visible native hit target");
  await click("increment"); await wait(() => snapshot().count === 1);
  await click("toggle"); await wait(async () => !(await state()).enabled);
  assert((await call("buttonState", "native-button-toggle")).title === "Enable increment", "Button title did not update");
  await click("increment");
  await new Promise(resolve => setTimeout(resolve, 100));
  assert(snapshot().count === 1, "Disabled button dispatched an action");
  const field = JSON.parse(await driver.call("fieldState", JSON.stringify({ id: "native-field" })));
  assert(field.value === "Initial name" && field.width > 0 && field.height > 0, "Native field default/layout missing");
  await driver.call("fieldEdit", JSON.stringify({ id: "native-field", value: "Edited name" }));
  await wait(() => snapshot().name === "Edited name");
  const select = await call("selectState", "native-select");
  assert(select.count === 2 && select.width > 0 && select.height > 0, "Distinct values must allow identical labels");
  await driver.call("selectChange", JSON.stringify({ id: "native-select", value: "second" }));
  await wait(() => snapshot().choice === "second");
  await click("remount"); await wait(() => snapshot().generation === 1);
  await wait(async () => (await call("selectState", "native-select")).value === "second");
  assert((await call("fieldState", "native-field")).value === "Edited name", "Default changes must not overwrite edited text");
  await wait(async () => !(await state()).enabled);
  await click("increment");
  await new Promise(resolve => setTimeout(resolve, 100));
  assert(snapshot().count === 1, "Remounted disabled button dispatched an action");
  await click("toggle"); await wait(async () => (await state()).enabled);
  await click("increment"); await wait(() => snapshot().count === 2);
  return ["Native NSButton hit target and layout", "Native action reaches React once", "Disabled state and dynamic label", "Remount and re-enable preserve behavior", "Native text editing and uncontrolled defaults", "Native selection, duplicate labels, and reordered options"];
}
const styles = StyleSheet.create({
  container: { gap: 8 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  text: { fontSize: 14 },
});
