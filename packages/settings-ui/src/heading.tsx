import { PlatformColor, StyleSheet, Text } from "react-native";

export const settingsRowInset = 12;
export const settingsHeadingGap = 10;

export function SettingsHeading({ title, variant }: { title: string; variant: "page" | "section" }) {
  return <Text accessibilityRole="header" style={[styles.inset, styles[variant], { color: PlatformColor("labelColor") }]}>{title}</Text>;
}

const styles = StyleSheet.create({
  inset: { marginHorizontal: settingsRowInset },
  page: { fontSize: 17, lineHeight: 22, fontWeight: "400" },
  section: { fontSize: 13, lineHeight: 16, fontWeight: "600" },
});
