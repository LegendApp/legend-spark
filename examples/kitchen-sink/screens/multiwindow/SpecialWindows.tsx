import { Text, View } from "react-native";
import { ActionButton } from "../../ActionButton";
import { Panel, Status } from "../../Panel";
import { HOTKEY, ROWS, TYPES, availability, closeAllWindows, runStep, useSpecialWindows } from "./special-windows";

const BUTTONS = [
  ["bar", "Create command bar"], ["bar-toggle", `Show or hide command bar (${HOTKEY})`], ["hud", "Show HUD"], ["preview", "Open preview"], ["preview-close", "Close preview"],
  ["pip", "Open picture in picture"], ["pip-topRight", "Snap picture in picture top right"], ["popover-notch", "Open notch popover"], ["popover-item", "Open menu bar item popover"],
  ["drawer", "Create edge drawer"], ["drawer-toggle", "Open or close edge drawer"], ["overlay", "Open click-through overlay"], ["widget", "Open desktop widget"],
  ["presenter", "Start presenter mode"], ["presenter-swap", "Swap presenter displays"], ["presenter-stop", "Stop presenter mode"],
] as const;

export function SpecialWindows() {
  const { rows, presenter, runs, steps, error } = useSpecialWindows();
  return <Panel title="Special windows">
    <View className="w-full max-w-xl gap-1" testID="multiwindow-special-windows-availability">
      {TYPES.map(type => <Text key={type} className="text-sm text-foreground" testID={`multiwindow-special-windows-availability-${type}-${availability(type)}`}>{type}: {availability(type)}</Text>)}
    </View>
    <View className="w-full max-w-xl gap-1 rounded-md border border-border p-3" testID="multiwindow-special-windows-readout">
      {ROWS.map(([row, label]) => <View key={row} className="flex-row gap-3">
        <Text className="w-44 text-sm font-semibold text-foreground">{label}</Text>
        <Text className="flex-1 text-sm text-foreground" testID={`multiwindow-special-windows-${row}`}>{rows[row]}</Text>
      </View>)}
      <Text className="text-sm text-muted" testID="multiwindow-special-windows-presenter">Presenter mode: {presenter}</Text>
      <Text className="text-sm text-muted" testID={`multiwindow-special-windows-run-${runs}-steps-${steps}`}>Linked run {runs}: {steps} steps</Text>
      {!!error && <Text className="text-sm text-danger" testID={`multiwindow-special-windows-error-${/^E_[A-Z_]+/.exec(error)?.[0] ?? "other"}`}>{error}</Text>}
    </View>
    <Status testID="multiwindow-special-windows-note">Driven runs never show these windows; the readout is what the window API reports.</Status>
    <View className="flex-row flex-wrap justify-center gap-2">
      {BUTTONS.map(([step, label]) => <ActionButton key={step} testID={`multiwindow-special-windows-${step}-button`} onPress={() => runStep(step)}>{label}</ActionButton>)}
      <ActionButton testID="multiwindow-special-windows-close-all" onPress={closeAllWindows}>Close all special windows</ActionButton>
    </View>
  </Panel>;
}
