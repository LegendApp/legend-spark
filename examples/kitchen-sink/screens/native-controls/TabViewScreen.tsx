import { useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Checkbox, RadioGroup } from "@legendapp/spark/ui";
import { Tab, TabView, getTabViewAvailability, type TabBorder, type TabPosition } from "@legendapp/spark/ui/tab-view";
import type { SparkError } from "@legendapp/spark/contracts";
import { Boundary, describe } from "./ControlPrimitives";
import { useContainerMessages, type TabId } from "./container-messages";

const TABS: readonly TabId[] = ["general", "appearance", "advanced"];
const POSITIONS: readonly TabPosition[] = ["top", "bottom", "leading", "trailing", "none"];
const BORDERS: readonly TabBorder[] = ["bezel", "line", "none"];

/** Controlled tab selection; with the lock on, native selections are reported but not adopted. */
function useTabViewDemo() {
  const [selected, setSelected] = useState<TabId>("general");
  const [position, setPosition] = useState<TabPosition>("top");
  const [border, setBorder] = useState<TabBorder>("bezel");
  const [locked, setLockedState] = useState(false);
  // A selection can arrive before React renders a lock change, so the handler reads the latest choice.
  const lockedRef = useRef(false);
  const [requests, setRequests] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  return {
    selected, setSelected, position, border, locked, requests, error,
    setLocked(next: boolean) { lockedRef.current = next; setLockedState(next); },
    // AppKit draws tabs on a bezel; other borders apply to a tabless view.
    setPosition(next: TabPosition) { setPosition(next); if (next !== "none") setBorder("bezel"); },
    setBorder,
    onSelectionChange({ id }: { id: string }) { setRequests(previous => [...previous.slice(-4), id]); if (!lockedRef.current) setSelected(id as TabId); },
    onError: (reported: SparkError) => setError(describe(reported)),
  };
}

export function TabViewScreen() {
  const t = useContainerMessages();
  const demo = useTabViewDemo();
  const id = "native-controls-tab-view";
  const options = <T extends string>(values: readonly T[], labels: Record<T, string>) => values.map(value => ({ value, label: labels[value] }));
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6">
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.tabViewTitle}</Text>
    <Text selectable className="font-mono text-xs text-muted" testID={`${id}-availability`}>{JSON.stringify(getTabViewAvailability())}</Text>
    <View className="flex-row items-center gap-3">
      <Text className="w-36 text-sm text-foreground">{t.position}</Text>
      <Boundary id={`${id}-position`}><RadioGroup testID={`${id}-position`} accessibilityLabel={t.position} options={options(POSITIONS, t.positions)} value={demo.position} onValueChange={value => demo.setPosition(value as TabPosition)} style={{ width: 420 }} /></Boundary>
    </View>
    <View className="flex-row items-center gap-3">
      <Text className="w-36 text-sm text-foreground">{t.border}</Text>
      <Boundary id={`${id}-border`}><RadioGroup testID={`${id}-border`} accessibilityLabel={t.border} disabled={demo.position !== "none"} options={options(BORDERS, t.borders)} value={demo.border} onValueChange={value => demo.setBorder(value as TabBorder)} style={{ width: 280 }} /></Boundary>
    </View>
    <View className="flex-row items-center gap-3">
      <Text className="w-36 text-sm text-foreground">{t.select}</Text>
      <Boundary id={`${id}-select`}><RadioGroup testID={`${id}-select`} accessibilityLabel={t.select} options={TABS.map(tab => ({ value: tab, label: t.tabs[tab].label }))} value={demo.selected} onValueChange={value => demo.setSelected(value as TabId)} style={{ width: 420 }} /></Boundary>
    </View>
    <Boundary id={`${id}-lock`}>
      <Checkbox testID={`${id}-lock`} label={t.lock} value={demo.locked} onValueChange={value => demo.setLocked(value === true)} />
    </Boundary>
    <Text selectable className="font-mono text-xs text-muted" testID={`${id}-style`}>{JSON.stringify({ tabPosition: demo.position, tabBorder: demo.border })}</Text>
    <Text selectable className="font-mono text-xs text-muted" testID={`${id}-selected`}>{JSON.stringify({ selectedId: demo.selected })}</Text>
    <Text selectable className="font-mono text-xs text-muted" testID={`${id}-requests`}>{JSON.stringify(demo.requests)}</Text>
    {demo.error && <Text selectable className="text-xs text-danger" testID={`${id}-error`}>{demo.error}</Text>}
    <Boundary id={`${id}-tabs`}>
      <TabView testID={`${id}-tabs`} selectedId={demo.selected} tabPosition={demo.position} tabBorder={demo.border} onSelectionChange={demo.onSelectionChange} onError={demo.onError}
        style={{ height: 220, width: "100%", maxWidth: 560 }}>
        {TABS.map(tab => <Tab key={tab} id={tab} label={t.tabs[tab].label} testID={`${id}-pane-${tab}`}>
          <View testID={`${id}-content-${tab}`} className="gap-2 p-4">
            <Text className="text-base font-bold text-foreground" accessibilityRole="header">{t.tabs[tab].label}</Text>
            <Text className="text-sm text-muted">{t.tabs[tab].body}</Text>
          </View>
        </Tab>)}
      </TabView>
    </Boundary>
  </ScrollView>;
}
