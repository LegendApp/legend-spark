import React, { useEffect, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import { openFileDialog } from "@legendapp/spark/dialogs";
import { configureMenus, clearMenus, addNativeMenuActionListener } from "@legendapp/spark/menus";

const menus = [{ id: "hello", title: "Hello", items: [{ id: "greet", title: "Say Hello" }] }];
export default function App({ runtime }: { runtime?: { mode: string } }) {
  const [message, setMessage] = useState("Ready");
  useEffect(() => {
    configureMenus("hello-world", menus);
    const subscription = addNativeMenuActionListener(action => {
      if (action.ownerId === "hello-world" && action.itemId === "greet") setMessage("Hello from the native menu");
    });
    return () => { subscription.remove(); clearMenus("hello-world"); };
  }, []);
  async function chooseFile() {
    try {
      const files = await openFileDialog({ title: "Choose a file", multiple: false });
      setMessage(files.canceled ? "Dialog cancelled" : files.paths.join(", "));
    } catch (error) { setMessage(String(error)); }
  }
  return <View style={styles.root}>
    <Text style={styles.title}>Hello, Legend Spark</Text>
    <Text style={styles.text}>Runtime: {runtime?.mode ?? "unknown"}</Text>
    <Button title="Choose a file" onPress={chooseFile} />
    <Text style={styles.text} accessible accessibilityLabel={message}>{message}</Text>
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, backgroundColor: "#f5f5f7" }, text: { color: "#18181b" }, title: { fontSize: 32, fontWeight: "600", color: "#18181b" } });
