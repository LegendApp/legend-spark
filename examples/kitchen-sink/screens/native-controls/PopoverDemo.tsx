import { Button, TextInput } from "@legendapp/spark/ui";
import { Popover } from "@legendapp/spark/ui/popover";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Panel, Status, errorText } from "../../Panel";

export function PopoverDemo() {
  const [open, setOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("Closed");
  const close = (reason: string) => { setOpen(false); setStatus(reason); };
  const composer = <View style={{ width: 280 }} className="gap-3 p-4">
    <Text className="text-sm font-semibold text-foreground">Add Comment</Text>
    <TextInput testID="native-controls-popover-text" accessibilityLabel="Comment" value={draft} onChangeText={setDraft} style={{ width: 248 }} />
    <View className="flex-row justify-end gap-2">
      <Pressable testID="native-controls-popover-cancel" accessibilityRole="button" onPress={() => close("Cancelled (React Pressable)")} className="rounded px-3 py-1"><Text className="text-sm text-foreground">Cancel</Text></Pressable>
      <Button testID="native-controls-popover-add" onPress={() => close(`Added: ${draft || "(empty)"}`)}>Add to Review</Button>
    </View>
  </View>;
  return <Panel title="Popover">
    <Status testID="native-controls-popover-status">{status}</Status>
    <Popover testID="native-controls-popover" visible={open} onClose={() => close("Closed by AppKit (click outside or Escape)")} onError={error => setStatus(errorText(error))} content={composer}>
      <Button testID="native-controls-popover-open" onPress={() => { setStatus("Open"); setOpen(true); }}>Add Comment…</Button>
    </Popover>
    <Popover testID="native-controls-popover-range" visible={rangeOpen} edge="top" anchorRect={{ x: 120, y: 0, width: 60, height: 18 }} onClose={() => setRangeOpen(false)} content={<Text style={{ width: 220 }} className="p-3 text-sm text-foreground">Anchored to a rect inside the text, such as a selection.</Text>}>
      <Text testID="native-controls-popover-range-text" onPress={() => setRangeOpen(true)} className="text-sm text-foreground" style={{ width: 320, height: 18 }}>Click this line: the popover points above “selection”.</Text>
    </Popover>
  </Panel>;
}
