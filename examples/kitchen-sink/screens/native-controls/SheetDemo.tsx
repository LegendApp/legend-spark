import { Button, TextInput } from "@legendapp/spark/ui";
import { Sheet } from "@legendapp/spark/ui/sheet";
import { useState } from "react";
import { Text, View } from "react-native";
import { Panel, Status, errorText } from "../../Panel";

export function SheetDemo() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("Closed");
  const close = (reason: string) => { setOpen(false); setStatus(reason); };
  return <Panel title="Sheet">
    <Status testID="native-controls-sheet-status">{status}</Status>
    <Button testID="native-controls-sheet-open" onPress={() => { setStatus("Open"); setOpen(true); }}>New Branch…</Button>
    <Sheet testID="native-controls-sheet" accessibilityLabel="New Branch" visible={open} onCancel={() => close("Cancelled (Escape)")} onError={error => setStatus(errorText(error))}>
      <View style={{ width: 380 }} className="gap-3 p-5">
        <Text className="text-sm font-semibold text-foreground">New Branch</Text>
        <TextInput testID="native-controls-sheet-name" accessibilityLabel="Branch name" placeholder="feature-name" value={name} onChangeText={setName} style={{ width: 340 }} />
        <TextInput testID="native-controls-sheet-description" accessibilityLabel="Description" placeholder="Description (optional)" multiline value={description} onChangeText={setDescription} style={{ width: 340, height: 80 }} />
        <View className="flex-row justify-end gap-2">
          <Button testID="native-controls-sheet-cancel" onPress={() => close("Cancelled")}>Cancel</Button>
          <Button testID="native-controls-sheet-create" onPress={() => close(`Created: ${name || "(empty)"}${description ? ` — ${description.split("\n").length} line(s)` : ""}`)}>Create Branch</Button>
        </View>
      </View>
    </Sheet>
  </Panel>;
}
