import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";

// Test IDs: native-controls-datetimepicker-<date|time|inline>-laid-out once each picker has a native frame.
// Fixed date, time zone and locale keep the golden stable.
const ID = "native-controls-datetimepicker";
const pickers = [
  { name: "date", mode: "date", display: "default" },
  { name: "time", mode: "time", display: "default" },
  { name: "inline", mode: "datetime", display: "inline" },
] as const;

/** @react-native-community/datetimepicker through its own API; Spark's patch hosts it in NSDatePicker. */
export function DateTimePickerDemo() {
  const [value, setValue] = useState(new Date(Date.UTC(2026, 0, 15, 9, 30)));
  const [laidOut, setLaidOut] = useState<string[]>([]);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6">
    <Text selectable className="font-mono text-xs text-muted">{value.toISOString()}</Text>
    {pickers.map(({ name, mode, display }) => <View key={name} className="flex-row items-center gap-3"
      testID={laidOut.includes(name) ? `${ID}-${name}-laid-out` : undefined}
      onLayout={event => event.nativeEvent.layout.height > 0 && setLaidOut(previous => previous.includes(name) ? previous : [...previous, name])}>
      <Text className="w-16 text-sm text-muted">{name}</Text>
      <DateTimePicker value={value} mode={mode} display={display} timeZoneName="UTC" locale="en_US" onValueChange={(_, date) => setValue(date)} />
    </View>)}
  </ScrollView>;
}
