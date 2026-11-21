import { Platform, Switch as NativeSwitch, View } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { unsupportedPlatform, useControl } from "./control";
import type { SwitchProps } from "./types";

export function Switch(props: SwitchProps) {
  const { value, onValueChange, accessibilityLabel, accessibilityHint, style, testID } = props;
  if (typeof value !== "boolean" || typeof onValueChange !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Switch requires a boolean value and onValueChange");
  const control = useControl(props, ["macos", "windows", "ios", "android", "web"].includes(Platform.OS) ? undefined : unsupportedPlatform);
  if (control.failed) return <View ref={control.ref} style={style} testID={testID} accessible accessibilityRole="switch" accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} accessibilityState={{ checked: value, disabled: true }} />;
  return <NativeSwitch ref={control.ref} value={value} onValueChange={next => { if (control.active()) onValueChange(next); }}
    disabled={control.disabled} accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} accessibilityState={{ checked: value }} style={style} testID={testID} />;
}
