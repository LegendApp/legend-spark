import { PlatformColor, StyleSheet, Text } from "react-native";

export const settingsRowInset = 12;
export const settingsHeadingGap = 10;

export function SettingsHeading({ title }: { title: string }) {
  return <Text accessibilityRole="header" style={[styles.heading, { color: PlatformColor("labelColor") }]}>{title}</Text>;
}

const styles = StyleSheet.create({
  heading: { fontSize: 13, lineHeight: 16, fontWeight: "600", marginHorizontal: settingsRowInset },
});
