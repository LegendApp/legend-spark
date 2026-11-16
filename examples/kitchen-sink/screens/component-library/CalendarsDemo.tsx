import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { Calendar } from "react-native-calendars";

// Test IDs: component-library-calendars.day_2026-11-16 (press it), then -selected-2026-11-16.
const ID = "component-library-calendars";

/** react-native-calendars: a month calendar with a marked range and day selection. */
export function CalendarsDemo() {
  const [selected, setSelected] = useState("");
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Calendar testID={ID} current="2026-11-01" onDayPress={day => setSelected(day.dateString)}
      markedDates={{ "2026-11-10": { marked: true, dotColor: "#ef4444" }, ...(selected ? { [selected]: { selected: true } } : {}) }} />
    <Text className="font-mono text-xs text-foreground" testID={`${ID}-selected-${selected || "none"}`}>{`selected ${selected || "none"}`}</Text>
  </ScrollView>;
}
