import { useRef, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button as NativeButton, Checkbox, RadioGroup, TextInput } from "@legendapp/spark/ui";
import { Popover, getPopoverAvailability, type PopoverAnchor, type PopoverBehavior, type PopoverEdge } from "@legendapp/spark/ui/popover";
import type { SparkError } from "@legendapp/spark/contracts";
import { Button } from "../../Controls";
import { Boundary, describe } from "./ControlPrimitives";
import { useContainerMessages, type AnchorMode } from "./container-messages";

const BEHAVIORS: readonly PopoverBehavior[] = ["transient", "semi-transient", "application-defined"];
const EDGES: readonly PopoverEdge[] = ["top", "bottom", "leading", "trailing"];
const ANCHORS: readonly AnchorMode[] = ["view", "rect"];

/** Popover configuration and its reported lifecycle. Readouts are JSON so flows can assert them in any locale. */
function usePopoverDemo() {
  const anchorView = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [behavior, setBehavior] = useState<PopoverBehavior>("transient");
  const [edge, setEdge] = useState<PopoverEdge>("bottom");
  const [mode, setMode] = useState<AnchorMode>("view");
  const [detachable, setDetachable] = useState(false);
  const [anchor, setAnchor] = useState<PopoverAnchor>({ ref: anchorView });
  const [events, setEvents] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const record = (event: string) => setEvents(previous => [...previous.slice(-4), event]);
  function show() {
    if (mode === "view") { setAnchor({ ref: anchorView }); setOpen(true); return; }
    // A window-content rect: the button's frame, measured when shown.
    anchorView.current?.measureInWindow((x, y, width, height) => { setAnchor({ rect: { x, y, width, height } }); setOpen(true); });
  }
  return {
    anchorView, open, behavior, setBehavior, edge, setEdge, mode, setMode, detachable, setDetachable, anchor, events, error, show,
    close: () => setOpen(false),
    onShow: () => record("shown"),
    onClose: () => { record("closed"); setOpen(false); },
    onDetach: () => record("detached"),
    onError: (reported: SparkError) => setError(describe(reported)),
  };
}

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return <View className="flex-row items-center gap-3">
    <Text className="w-36 text-sm text-foreground">{label}</Text>
    {children}
  </View>;
}

export function PopoverScreen() {
  const t = useContainerMessages();
  const demo = usePopoverDemo();
  const id = "native-controls-popover";
  const options = <T extends string>(values: readonly T[], labels: Record<T, string>) => values.map(value => ({ value, label: labels[value] }));
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6">
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.popoverTitle}</Text>
    <Text selectable className="font-mono text-xs text-muted" testID={`${id}-availability`}>{JSON.stringify(getPopoverAvailability())}</Text>
    <Setting label={t.behavior}>
      <Boundary id={`${id}-behavior`}><RadioGroup testID={`${id}-behavior`} accessibilityLabel={t.behavior} options={options(BEHAVIORS, t.behaviors)} value={demo.behavior} onValueChange={value => demo.setBehavior(value as PopoverBehavior)} style={{ width: 420 }} /></Boundary>
    </Setting>
    <Setting label={t.edge}>
      <Boundary id={`${id}-edge`}><RadioGroup testID={`${id}-edge`} accessibilityLabel={t.edge} options={options(EDGES, t.edges)} value={demo.edge} onValueChange={value => demo.setEdge(value as PopoverEdge)} style={{ width: 420 }} /></Boundary>
    </Setting>
    <Setting label={t.anchor}>
      <Boundary id={`${id}-anchor-mode`}><RadioGroup testID={`${id}-anchor-mode`} accessibilityLabel={t.anchor} options={options(ANCHORS, t.anchors)} value={demo.mode} onValueChange={value => demo.setMode(value as AnchorMode)} style={{ width: 280 }} /></Boundary>
    </Setting>
    <Boundary id={`${id}-detachable`}>
      <Checkbox testID={`${id}-detachable`} label={t.detachable} value={demo.detachable} onValueChange={value => demo.setDetachable(value === true)} />
    </Boundary>
    {/* A Spark Button's ref is a layout ref, so a host view carries the anchor ref. */}
    <View ref={demo.anchorView} collapsable={false} testID={`${id}-anchor`} className="self-start">
      <Button testID={`${id}-show`} onPress={demo.show}>{t.show}</Button>
    </View>
    <Text selectable className="font-mono text-xs text-muted" testID={`${id}-open`}>{JSON.stringify({ open: demo.open, anchor: demo.mode })}</Text>
    <Text selectable className="font-mono text-xs text-muted" testID={`${id}-events`}>{JSON.stringify(demo.events)}</Text>
    {demo.error && <Text selectable className="text-xs text-danger" testID={`${id}-error`}>{demo.error}</Text>}
    <Boundary id={`${id}-host`}>
      <Popover testID={`${id}-host`} open={demo.open} anchor={demo.anchor} behavior={demo.behavior} preferredEdge={demo.edge} detachable={demo.detachable}
        onShow={demo.onShow} onClose={demo.onClose} onDetach={demo.onDetach} onError={demo.onError}>
        <View testID={`${id}-content`} className="gap-2 p-4" style={{ width: 280 }}>
          <Text className="text-base font-bold text-foreground" accessibilityRole="header">{t.contentTitle}</Text>
          <Text className="text-sm text-muted">{t.contentBody}</Text>
          <TextInput testID={`${id}-note`} accessibilityLabel={t.note} defaultValue="" style={{ width: 248 }} />
          <NativeButton testID={`${id}-close`} onPress={demo.close} style={{ width: 248 }}>{t.close}</NativeButton>
        </View>
      </Popover>
    </Boundary>
  </ScrollView>;
}
