import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import DateTimePickerModal from "react-native-modal-datetime-picker";

// Test IDs: component-library-modal-datetime-picker-open while the picker sheet shows (its Confirm button is
// testID'd by the library as ...-confirm via confirmButtonTestID); -result-<value> after Confirm or Cancel.
const ID = "component-library-modal-datetime-picker";

/** react-native-modal-datetime-picker: the date picker in a bottom sheet over React Native's Modal, with Confirm and Cancel. */
export function ModalDateTimePickerDemo() {
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState("none");
  useEffect(() => { setVisible(true); }, []);
  return <View className="flex-1 bg-background p-6 gap-3">
    <Pressable testID={`${ID}-show`} onPress={() => setVisible(true)} style={{ padding: 12, borderRadius: 8, backgroundColor: "#3b82f6", alignSelf: "flex-start" }}><Text style={{ color: "white" }}>Pick a date</Text></Pressable>
    <Text className="font-mono text-xs text-foreground" testID={`${ID}-result-${result}`}>{`result ${result}`}</Text>
    {visible && <Text testID={`${ID}-open`} className="text-xs text-muted">picker open</Text>}
    <DateTimePickerModal isVisible={visible} mode="date" date={new Date(2026, 10, 16)} confirmButtonTestID={`${ID}-confirm`} cancelButtonTestID={`${ID}-cancel`}
      onConfirm={date => { setResult(date.toISOString().slice(0, 10)); setVisible(false); }} onCancel={() => { setResult("cancelled"); setVisible(false); }} />
  </View>;
}
