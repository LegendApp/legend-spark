import { createContext, useContext, useEffect, type ComponentProps } from "react";
import { Appearance, Platform, Text as NativeText, useColorScheme } from "react-native";
import type { Theme } from "./session";
const light = { background: "#faf9f6", surface: "#ffffff", text: "#222222", border: "#d8d5cf", selected: "#dce9ef" };
const dark = { background: "#191919", surface: "#252525", text: "#eeeeee", border: "#505050", selected: "#29475b" };
export const ThemeContext = createContext(light);
export function usePalette(theme: Theme) {
  const system = useColorScheme();
  useEffect(() => {
    if (Platform.OS !== "web") Appearance.setColorScheme(theme === "system" ? "unspecified" : theme);
  }, [theme]);
  return (theme === "system" ? system : theme) === "dark" ? dark : light;
}
export function Text(props: ComponentProps<typeof NativeText>) {
  const palette = useContext(ThemeContext);
  return <NativeText {...props} style={[{ color: palette.text }, props.style]} />;
}
