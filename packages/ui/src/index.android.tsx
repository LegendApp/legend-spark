import { portableButtonVariant } from "./button";
export { getButtonAvailability } from "./button";
export type { ButtonVariant, ButtonAvailabilityOptions } from "./types";
import { isPrimitiveKind } from "./primitives";
import type { ComponentProps } from "react";
function ExpoButton(props: ComponentProps<typeof import("@expo/ui/jetpack-compose").Button>) {
  const Component = (require("@expo/ui/jetpack-compose") as typeof import("@expo/ui/jetpack-compose")).Button;
  return <Component {...props} />;
}
import { View, Text } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { selectionIndex } from "./select";
import { useControl, validateButton } from "./control";
import type { ButtonProps, SelectProps, SegmentedControlProps, ControlKind } from "./types";
export type { ButtonProps, TextInputProps, ControlledTextInputProps, UncontrolledTextInputProps, SelectProps, SelectOption, SegmentedControlProps, ControlProps, ControlRef, ControlKind } from "./types";
export { TextInput } from "./mobile-input";
export function getControlAvailability(control: ControlKind): Availability {
  if (isPrimitiveKind(control)) return { available: false, reason: "unsupported-platform" };
  if (!["button", "text-input", "select", "segmented-control"].includes(control)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown control kind");
  return control === "text-input" || requireOptionalNativeModule("ExpoUI") ? { available: true } : { available: false, reason: "missing-module" };
}
export function Button(props: ButtonProps) {
  validateButton(props); const variant = portableButtonVariant(props); const control = useControl(props, getControlAvailability("button"));
  const { children, onPress, style, testID, accessibilityLabel = children } = props;
  return <View ref={control.ref} style={[{ width: 160, height: 48 }, style]} testID={testID}>
    {control.failed ? <Text accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: true }}>{children}</Text> :
      <ExpoButton style={{ flex: 1 }} onPress={() => { if (control.active()) onPress?.(); }} disabled={control.disabled} variant={variant} {...{ accessibilityLabel }}>{children}</ExpoButton>}
  </View>;
}
function Selection(props: SelectProps) {
  const selected = selectionIndex(props.options, props.value);
  if (typeof props.onValueChange !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected onValueChange");
  const control = useControl(props, getControlAvailability("select"));
  return <View ref={control.ref} style={[{ width: 280, minHeight: 48, flexDirection: "row" }, props.style]} testID={props.testID} accessibilityLabel={props.accessibilityLabel}>
    {control.failed ? <Text accessibilityState={{ disabled: true }}>{props.options[selected].label}</Text> : props.options.map(option =>
      <ExpoButton key={option.value} disabled={control.disabled} variant={option.value === props.value ? "bordered" : "borderless"} style={{ flex: 1 }}
        {...{ accessibilityRole: "radio", accessibilityState: { checked: option.value === props.value, disabled: control.disabled } }}
        onPress={() => { if (control.active()) props.onValueChange(option.value); }}>{option.label}</ExpoButton>)}
  </View>;
}
/** Android presents its choices inline; there is no dropdown backend in the pinned Expo UI. */
export function Select(props: SelectProps) { return <Selection {...props} />; }
export function SegmentedControl(props: SegmentedControlProps) { return <Selection {...props} />; }

export * from "./primitives-controls";
