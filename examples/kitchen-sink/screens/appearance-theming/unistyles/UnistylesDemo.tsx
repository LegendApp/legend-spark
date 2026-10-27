import { Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

// Test IDs: appearance-theming-unistyles-theme-<light|dark> follows the app's appearance through
// Unistyles' adaptive themes; appearance-theming-unistyles-runtime-ready appears once the native
// runtime reports a window size and pixel ratio.
const ID = "appearance-theming-unistyles";
const themes = {
  light: { colors: { background: "#f4f4f5", foreground: "#18181b", accent: "#2563eb" } },
  dark: { colors: { background: "#18181b", foreground: "#f4f4f5", accent: "#60a5fa" } },
};
const breakpoints = { xs: 0, md: 700 };
type Themes = typeof themes;
type Breakpoints = typeof breakpoints;
declare module "react-native-unistyles" {
  export interface UnistylesThemes extends Themes {}
  export interface UnistylesBreakpoints extends Breakpoints {}
}
StyleSheet.configure({ themes, breakpoints, settings: { adaptiveThemes: true } });

const styles = StyleSheet.create((theme, rt) => ({
  card: { gap: 8, padding: 16, borderRadius: 12, borderWidth: 2, borderColor: theme.colors.accent, backgroundColor: theme.colors.background, width: { xs: "100%", md: rt.screen.width / 2 } },
  text: { color: theme.colors.foreground, fontFamily: "Menlo", fontSize: 12 },
}));

/** react-native-unistyles themes, breakpoints and runtime values from its own API. */
export function UnistylesDemo() {
  const { rt } = useUnistyles();
  return <View style={{ padding: 24, gap: 12 }}>
    <View style={styles.card}>
      <Text style={styles.text} testID={`${ID}-theme-${rt.themeName}`}>{`theme: ${rt.themeName} (color scheme ${rt.colorScheme})`}</Text>
      <Text style={styles.text} testID={`${ID}-breakpoint-${rt.breakpoint}`}>{`breakpoint: ${rt.breakpoint}`}</Text>
      <Text style={styles.text} testID={rt.screen.width > 0 && rt.pixelRatio >= 1 ? `${ID}-runtime-ready` : undefined}>{`window: ${Math.round(rt.screen.width)}×${Math.round(rt.screen.height)} @${rt.pixelRatio}x, insets ${JSON.stringify(rt.insets)}`}</Text>
    </View>
  </View>;
}
