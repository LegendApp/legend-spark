import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { ThreadedReactSurface } from "@react-native-runtimes/core";
import { Button } from "@legendapp/spark/ui/uniwind";
import type { PluginInfo } from "@legendapp/spark/plugins";
import { shortName, usePluginsDemo } from "./plugins-demo";
import { usePluginsMessages } from "./plugins-messages";

// Test IDs: future-facing-capabilities-plugins-<plugin>-state shows the state ("loaded", "failed (E_PERMISSION_DENIED)"),
// -<plugin>-load / -<plugin>-unload act and -<plugin>-result shows what they returned. Registered items are
// -command-<plugin>-<name>, -menu-<plugin>-<name>, -open-sample and -panel-<plugin>-<name>; -output is the last command's result.
const ID = "future-facing-capabilities-plugins";
const last = (id: string) => id.slice(id.lastIndexOf(".") + 1);
const stateText = ({ state, error }: PluginInfo) => error ? `${state} (${error.code})` : state;

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return <View className="gap-2">
    <Text className="text-base font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    <View className="gap-2 rounded-md border border-border p-3" testID={`${ID}-${id}`}>{children}</View>
  </View>;
}

/** Loads the bundled sample plugins into isolated runtimes and runs what they register (@legendapp/spark/plugins). */
export function Plugins() {
  const t = usePluginsMessages();
  const { availability, plugins, results, output, toggle, execute, runMenuItem, openSample } = usePluginsDemo();
  const loaded = plugins.filter(plugin => plugin.state === "loaded");
  const items = <T,>(pick: (plugin: PluginInfo) => readonly T[]) => loaded.flatMap(plugin => pick(plugin).map(item => ({ plugin, item })));
  const commands = items(plugin => plugin.contributions.commands), menuItems = items(plugin => plugin.contributions.menuItems);
  const fileTypes = items(plugin => plugin.contributions.fileTypes), panels = items(plugin => plugin.contributions.panels);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6" testID={`${ID}-content`}>
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="text-sm text-muted">{t.intro}</Text>
    <Section title={t.availability} id="availability-section">
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-availability`}>{JSON.stringify(availability)}</Text>
      <Text className="text-xs text-muted">{t.security}</Text>
    </Section>
    <Section title={t.declared} id="declared">
      {plugins.map(plugin => {
        const name = shortName(plugin.manifest);
        return <View key={plugin.manifest.id} className="flex-row items-center gap-3">
          <View className="w-56 gap-0.5">
            <Text className="text-sm text-foreground">{`${plugin.manifest.name} ${plugin.manifest.version}`}</Text>
            <Text selectable className="font-mono text-xs text-muted">{`${plugin.manifest.id} · API ${plugin.manifest.apiVersion}`}</Text>
          </View>
          <View className="flex-1 gap-0.5">
            <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-${name}-state`}>{stateText(plugin)}</Text>
            {results[name] !== undefined && <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-${name}-result`}>{results[name]}</Text>}
          </View>
          <Button className="w-24" testID={`${ID}-${name}-load`} onPress={() => void toggle(plugin.manifest, "load")}>{t.load}</Button>
          <Button className="w-24" testID={`${ID}-${name}-unload`} onPress={() => void toggle(plugin.manifest, "unload")}>{t.unload}</Button>
        </View>;
      })}
    </Section>
    <Section title={t.registered} id="registered">
      {loaded.length === 0 && <Text className="text-sm text-muted" testID={`${ID}-none`}>{t.none}</Text>}
      {commands.length > 0 && <Text className="text-xs font-semibold text-muted">{t.commands}</Text>}
      <View className="flex-row flex-wrap gap-2">
        {commands.map(({ plugin, item }) => <Button key={item.id} testID={`${ID}-command-${shortName(plugin.manifest)}-${last(item.id)}`}
          onPress={() => void execute(plugin.manifest.id, item.id, { text: "ping" })}>{item.title}</Button>)}
      </View>
      {menuItems.length > 0 && <Text className="text-xs font-semibold text-muted">{t.menuItems}</Text>}
      {menuItems.map(({ plugin, item }) => <Button key={item.id} testID={`${ID}-menu-${shortName(plugin.manifest)}-${last(item.id)}`}
        onPress={() => void runMenuItem(item.id)}>{item.title}</Button>)}
      {fileTypes.length > 0 && <Text className="text-xs font-semibold text-muted">{t.fileTypes}</Text>}
      {fileTypes.map(({ item }) => <Text key={item.id} selectable className="font-mono text-xs text-foreground">{`${item.name} (.${item.extensions.join(", .")}) → ${item.command}`}</Text>)}
      {fileTypes.length > 0 && <Button testID={`${ID}-open-sample`} onPress={() => void openSample()}>{t.openSample}</Button>}
      {panels.length > 0 && <Text className="text-xs font-semibold text-muted">{t.panels}</Text>}
      {panels.map(({ plugin, item }) => <View key={item.id} className="h-32 rounded-md border border-border">
        <ThreadedReactSurface componentName={item.component} runtimeName={plugin.runtimeName} initialProps={{ label: t.panelLabel }} surfaceKey={item.id}
          style={{ flex: 1 }} testID={`${ID}-panel-${shortName(plugin.manifest)}-${last(item.id)}`} />
      </View>)}
    </Section>
    <Section title={t.output} id="output-section">
      <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-output`}>{output ?? "—"}</Text>
    </Section>
  </ScrollView>;
}
