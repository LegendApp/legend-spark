import { useState, type ComponentProps } from "react";
function ExpoButton(props: ComponentProps<typeof import("@expo/ui/swift-ui").Button>) {
  const Component = (require("@expo/ui/swift-ui") as typeof import("@expo/ui/swift-ui")).Button;
  return <Component {...props} />;
}
function Host(props: ComponentProps<typeof import("@expo/ui/swift-ui").Host>) {
  const Component = (require("@expo/ui/swift-ui") as typeof import("@expo/ui/swift-ui")).Host;
  return <Component {...props} />;
}
function Picker(props: ComponentProps<typeof import("@expo/ui/swift-ui").Picker>) {
  const Component = (require("@expo/ui/swift-ui") as typeof import("@expo/ui/swift-ui")).Picker;
  return <Component {...props} />;
}
import { frame, disabled as disabledModifier, accessibilityLabel as labelModifier } from "@expo/ui/swift-ui/modifiers";
import { View, Text } from "react-native";
import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { requireOptionalNativeModule } from "expo-modules-core";
import { useControl, validateButton } from "./control";
import { selectionIndex } from "./select";
import type { ButtonProps, SelectProps, SegmentedControlProps, ControlKind } from "./types";
export type { ButtonProps, TextInputProps, ControlledTextInputProps, UncontrolledTextInputProps, SelectProps, SelectOption, SegmentedControlProps, ControlProps, ControlRef, ControlKind } from "./types";
export { TextInput } from "./mobile-input";
export function getControlAvailability(control: ControlKind): Availability {
  if (!["button", "text-input", "select", "segmented-control"].includes(control)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown control kind");
  return control === "text-input" || requireOptionalNativeModule("ExpoUI") ? { available: true } : { available: false, reason: "missing-module" };
}
const fill = [frame({ maxWidth: Infinity, maxHeight: Infinity })];
export function Button(props: ButtonProps) {
  validateButton(props); const control = useControl(props, getControlAvailability("button"));
  const { children, onPress, variant = "default", style, testID, accessibilityLabel = children } = props;
  return <View ref={control.ref} style={[{ width: 160, height: 44 }, style]}>
    {control.failed ? <Text accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: true }} testID={testID}>{children}</Text> :
      <Host style={{ flex: 1 }}><ExpoButton onPress={() => { if (control.active()) onPress?.(); }} disabled={control.disabled}
        variant={variant} modifiers={[...fill, labelModifier(accessibilityLabel)]} testID={testID}>{children}</ExpoButton></Host>}
  </View>;
}
function Selection({ segmented, ...props }: SelectProps & { segmented: boolean }) {
  const selectedIndex = selectionIndex(props.options, props.value);
  const [selectionRevision, revise] = useState(0);
  if (typeof props.onValueChange !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected onValueChange");
  const control = useControl(props, getControlAvailability(segmented ? "segmented-control" : "select"));
  const { options, onValueChange, accessibilityLabel, style, testID } = props;
  const modifiers = [disabledModifier(control.disabled), ...(accessibilityLabel ? [labelModifier(accessibilityLabel)] : [])];
  return <View ref={control.ref} style={[{ width: 240, height: 44 }, style]}>
    {control.failed ? <Text accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: true }} testID={testID}>{options[selectedIndex].label}</Text> :
      <Host style={{ flex: 1 }}><Picker key={selectionRevision} variant={segmented ? "segmented" : "menu"} options={options.map(option => option.label)} selectedIndex={selectedIndex}
        onOptionSelected={event => {
          if (!control.active()) return;
          const index = event?.nativeEvent?.index;
          if (!Number.isInteger(index) || !options[index]) { control.error(new SparkError("E_INVALID_DATA", "Invalid native selection")); return; }
          // Expo's SwiftUI picker retains local selection and ignores an unchanged
          // selectedIndex. A fresh picker also restores a parent-vetoed selection.
          revise(value => value + 1);
          onValueChange(options[index].value);
        }} modifiers={modifiers} testID={testID} /></Host>}
  </View>;
}
export function Select(props: SelectProps) { return <Selection {...props} segmented={false} />; }
export function SegmentedControl(props: SegmentedControlProps) { return <Selection {...props} segmented />; }
