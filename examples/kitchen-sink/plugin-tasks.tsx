import { useState } from "react";
import { Pressable, Text, View, useColorScheme } from "react-native";
import { getCurrentRuntime, runtimeFunction, threadedComponent } from "@react-native-runtimes/core";
import { definePlugin, type PluginManifest } from "@legendapp/spark/plugins";

// The Kitchen Sink's bundled sample plugins (Future-facing capabilities > Plugins). Development runtime discovery scans
// top-level files, so their entries and the hello panel live here. Everything below the manifests runs only in each
// plugin's own isolated runtime; module state such as `greetings` lives in that runtime's heap.

/** The screen sets this global on the main runtime; a plugin runtime must not see it. */
export const HOST_GLOBAL = "__ksPluginHostProbe";
const runtime = () => { const current = getCurrentRuntime(); return { runtime: current.name, main: current.isMain }; };

export const helloManifest: PluginManifest = { id: "so.legend.ks.hello", name: "Hello", version: "1.0.0", apiVersion: 1, capabilities: ["commands", "panels", "fileTypes", "menuItems"] };
let greetings = 0;
export const helloPlugin = runtimeFunction(definePlugin(helloManifest, {
  activate: () => ({
    commands: [
      { id: "so.legend.ks.hello.greet", title: "Greet" },
      { id: "so.legend.ks.hello.crash", title: "Crash on purpose" },
      { id: "so.legend.ks.hello.open-note", title: "Open note" },
    ],
    panels: [{ id: "so.legend.ks.hello.panel", title: "Hello panel", component: "ks-plugin-hello-panel" }],
    fileTypes: [{ id: "so.legend.ks.hello.note", name: "Kitchen Sink note", extensions: ["ksnote"], command: "so.legend.ks.hello.open-note" }],
    menuItems: [{ id: "so.legend.ks.hello.menu-greet", title: "Greet from the menu", command: "so.legend.ks.hello.greet" }],
  }),
  commands: {
    "so.legend.ks.hello.greet": () => ({ greeting: "Hello", ...runtime(), hostGlobalVisible: HOST_GLOBAL in globalThis, greetings: ++greetings }),
    "so.legend.ks.hello.crash": () => { throw new Error("The hello plugin crashed on purpose"); },
    "so.legend.ks.hello.open-note": args => ({ opened: (args as { path: string }).path, ...runtime() }),
  },
}));

export const echoManifest: PluginManifest = { id: "so.legend.ks.echo", name: "Echo", version: "1.0.0", apiVersion: 1, capabilities: ["commands"] };
export const echoPlugin = runtimeFunction(definePlugin(echoManifest, {
  activate: () => ({ commands: [{ id: "so.legend.ks.echo.echo", title: "Echo" }] }),
  commands: { "so.legend.ks.echo.echo": args => ({ echoed: args, ...runtime(), hostGlobalVisible: HOST_GLOBAL in globalThis }) },
}));

/** Requests only commands, then registers a menu item too: the host rejects the sandbox violation. */
export const overreachManifest: PluginManifest = { id: "so.legend.ks.overreach", name: "Overreach", version: "1.0.0", apiVersion: 1, capabilities: ["commands"] };
export const overreachPlugin = runtimeFunction(definePlugin(overreachManifest, {
  activate: () => ({
    commands: [{ id: "so.legend.ks.overreach.run", title: "Run" }],
    menuItems: [{ id: "so.legend.ks.overreach.menu", title: "Injected menu item", command: "so.legend.ks.overreach.run" }],
  }),
  commands: { "so.legend.ks.overreach.run": () => null },
}));

const neverActivates = { activate: () => { throw new Error("The host must reject this plugin before it runs"); } };
/** Written for plugin API 2; this host implements 1. */
export const futureManifest: PluginManifest = { id: "so.legend.ks.future", name: "Future", version: "2.0.0", apiVersion: 2, capabilities: ["commands"] };
export const futurePlugin = runtimeFunction(definePlugin(futureManifest, neverActivates));
/** Requests panels, which the Kitchen Sink does not grant it. */
export const ungrantedManifest: PluginManifest = { id: "so.legend.ks.ungranted", name: "Ungranted", version: "1.0.0", apiVersion: 1, capabilities: ["commands", "panels"] };
export const ungrantedPlugin = runtimeFunction(definePlugin(ungrantedManifest, neverActivates));

function HelloPanelContent({ label }: { label?: string }) {
  const [count, setCount] = useState(0);
  const dark = useColorScheme() === "dark", color = dark ? "#f5f5f5" : "#111827";
  const { runtime: name, main } = runtime();
  return <View style={{ flex: 1, padding: 12, gap: 8 }}>
    <Text style={{ color, fontWeight: "600" }}>{label ?? "Hello panel"}</Text>
    <Text style={{ color }} testID="future-facing-capabilities-plugins-panel-runtime">{`${name} · main: ${String(main)}`}</Text>
    <Pressable accessibilityRole="button" testID="future-facing-capabilities-plugins-panel-increment" onPress={() => setCount(value => value + 1)}
      style={{ borderWidth: 1, borderColor: color, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start" }}>
      <Text style={{ color }}>{`Count: ${count}`}</Text>
    </Pressable>
  </View>;
}
export const HelloPanel = threadedComponent("ks-plugin-hello-panel", HelloPanelContent);
