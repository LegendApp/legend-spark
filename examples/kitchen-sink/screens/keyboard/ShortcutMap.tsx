import type { ComponentProps, PropsWithChildren } from "react";
import { ScrollView, Text, View } from "react-native";
import { HotkeyCapture, formatHotkey, getReservedShortcuts, getShortcutMapAvailability, useShortcutMap, type ShortcutMap, type ShortcutMapCommandState } from "@legendapp/spark/shortcuts/commands";
import { Button as NativeButton } from "@legendapp/spark/ui/uniwind";
import { Button } from "../../Controls";
import { EXAMPLES, SCOPES, useShortcutMapDemo, type DemoCommandId, type ExampleId } from "./shortcut-map-demo";
import { useShortcutMapMessages, type ShortcutMapMessages } from "./shortcut-map-messages";

// Test IDs: keyboard-shortcut-map-<command>-{bindings,customized,conflict-<n>,record,unbind,reset},
// keyboard-shortcut-map-example-<id>, -result, -fired and -availability-<scope>.
const ID = "keyboard-shortcut-map";

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View className="w-full max-w-3xl gap-2">
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </View>;
}

function CommandRow({ command, t, onRecord, onUnbind, onReset }: { command: ShortcutMapCommandState<DemoCommandId>; t: ShortcutMapMessages; onRecord(binding: string): void; onUnbind(): void; onReset(): void }) {
  const row = `${ID}-${command.id}`;
  return <View className="gap-1 border-b border-border px-4 py-2" testID={`${row}-row`}>
    <View className="flex-row flex-wrap items-center gap-2">
      <Text className="min-w-32 flex-1 text-sm font-semibold text-foreground">{t.commands[command.id]}</Text>
      {command.customized ? <Text className="rounded-md bg-highlight px-2 py-0.5 text-xs text-foreground" testID={`${row}-customized`}>{t.customized}</Text> : null}
      <Text className="w-16 rounded-md bg-background px-2 py-0.5 text-center text-xs text-muted">{t.scopes[command.scope]}</Text>
      <Text selectable className="w-32 font-mono text-sm text-foreground" testID={`${row}-bindings`}>{command.bindings.length ? command.bindings.map(binding => formatHotkey(binding)).join(", ") : t.unbound}</Text>
      <View testID={`${row}-record`}><HotkeyCapture className="min-w-24 border-border bg-background" placeholder={t.record} value={null} onChange={value => { if (value !== null) onRecord(value); }} /></View>
      <RowButton testID={`${row}-unbind`} disabled={!command.bindings.length} onPress={onUnbind}>{t.unbind}</RowButton>
      <RowButton testID={`${row}-reset`} disabled={!command.customized} onPress={onReset}>{t.reset}</RowButton>
    </View>
    {command.conflicts.map((conflict, index) => <Text key={index} className="text-xs text-danger" testID={`${row}-conflict-${conflict.with.source}`}>
      {`${formatHotkey(conflict.binding)} · ${t.conflict(t.party(conflict.with, id => t.commands[id as DemoCommandId] ?? id))}`}
    </Text>)}
  </View>;
}
function RowButton(props: ComponentProps<typeof NativeButton>) { return <NativeButton className="w-24" {...props} />; }

export function ShortcutMap() {
  const t = useShortcutMapMessages();
  const { state, feedback, example, record, unbind, reset } = useShortcutMapDemo(t);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="items-center gap-5 p-6">
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="max-w-3xl text-center text-sm text-muted">{t.intro}</Text>
    {state.status === "ready"
      ? <Commands map={state.map} t={t} onExample={id => void example(id)} onRecord={(id, binding) => void record(id, binding)} onUnbind={id => void unbind(id)} onReset={id => void reset(id)} />
      : <Text className="text-sm text-muted" testID={`${ID}-status`}>{state.status === "error" ? t.failed(state.error) : t.loading}</Text>}
    <Section title={t.sections.availability}>
      {SCOPES.map(scope => <Text key={scope} selectable className="font-mono text-xs text-muted" testID={`${ID}-availability-${scope}`}>{`${scope}: ${JSON.stringify(getShortcutMapAvailability(scope))}`}</Text>)}
    </Section>
    <Section title={t.sections.reserved}>
      <Text selectable className="text-xs text-muted" testID={`${ID}-reserved`}>{getReservedShortcuts().filter(entry => entry.severity === "reserved").map(entry => formatHotkey(entry.accelerator)).join("   ")}</Text>
    </Section>
    <Section title={t.sections.activity}>
      <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-result`}>{t.result(feedback.result ?? "—")}</Text>
      <Text selectable className="text-sm text-foreground" testID={`${ID}-fired`}>{feedback.fired ? t.fired(t.commands[feedback.fired.id], formatHotkey(feedback.fired.binding), t.scopes[feedback.fired.scope]) : t.noFired}</Text>
    </Section>
  </ScrollView>;
}

type CommandsProps = { map: ShortcutMap<DemoCommandId>; t: ShortcutMapMessages; onExample(id: ExampleId): void; onRecord(id: DemoCommandId, binding: string): void; onUnbind(id: DemoCommandId): void; onReset(id?: DemoCommandId): void };
function Commands({ map, t, onExample, onRecord, onUnbind, onReset }: CommandsProps) {
  const { commands } = useShortcutMap(map);
  return <>
    <Section title={t.sections.commands}>
      <View className="overflow-hidden rounded-lg border border-border bg-surface" testID={`${ID}-commands`}>
        {commands.map(command => <CommandRow key={command.id} command={command} t={t} onRecord={binding => onRecord(command.id, binding)} onUnbind={() => onUnbind(command.id)} onReset={() => onReset(command.id)} />)}
      </View>
    </Section>
    <Section title={t.sections.examples}>
      <View className="flex-row flex-wrap gap-2">
        {(Object.keys(EXAMPLES) as ExampleId[]).map(id => <Button key={id} testID={`${ID}-example-${id}`} onPress={() => onExample(id)}>{t.examples[id]}</Button>)}
        <Button testID={`${ID}-reset-all`} disabled={!commands.some(command => command.customized)} onPress={() => onReset()}>{t.resetAll}</Button>
      </View>
    </Section>
  </>;
}
