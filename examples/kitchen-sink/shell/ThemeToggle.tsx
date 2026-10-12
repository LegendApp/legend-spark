import { Uniwind, useUniwind } from "uniwind";
import { Button } from "../Controls";
import { useI18n } from "./app-controller";
import type { ThemeChoice } from "./i18n";

export function ThemeToggle() {
  const { t } = useI18n();
  const { theme, hasAdaptiveThemes } = useUniwind();
  const current: ThemeChoice = hasAdaptiveThemes ? "system" : theme === "light" ? "light" : "dark";
  const next: ThemeChoice = current === "system" ? "light" : current === "light" ? "dark" : "system";
  return <Button testID="infra-shell-theme-toggle" onPress={() => Uniwind.setTheme(next)}>{t.theme(current, next)}</Button>;
}
