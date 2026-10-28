import { useColorScheme } from "react-native";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";

export default function Layout() {
  return <ThemeProvider value={useColorScheme() === "dark" ? DarkTheme : DefaultTheme}><Stack /></ThemeProvider>;
}
