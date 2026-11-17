import { useState, type ComponentProps } from "react";
function ExpoButton(props: ComponentProps<typeof import("@expo/ui/swift-ui").Button>) {
  const Component = (require("@expo/ui/swift-ui") as typeof import("@expo/ui/swift-ui")).Button;
  return <Component {...props} />;
}
function Host(props: ComponentProps<typeof import("@expo/ui/swift-ui").Host>) {
  const Component = (require("@expo/ui/swift-ui") as typeof import("@expo/ui/swift-ui")).Host;
  return <Component {...props} />;
}
function Picker(props: ComponentProps<typeof import("@expo/ui/swift-ui").Picker<number>>) {
  const Component = (require("@expo/ui/swift-ui") as typeof import("@expo/ui/swift-ui")).Picker<number>;
  return <Component {...props} />;
}
function Option(props: ComponentProps<typeof import("@expo/ui/swift-ui").Text>) {
  const Component = (require("@expo/ui/swift-ui") as typeof import("@expo/ui/swift-ui")).Text;
  return <Component {...props} />;
}
import { frame, buttonStyle, pickerStyle, tag, disabled as disabledModifier, accessibilityLabel as labelModifier } from "@expo/ui/swift-ui/modifiers";
import { View, Text } from "react-native";
import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { requireOptionalNativeModule } from "expo-modules-core";
import { controlKinds, macosButton, unsupportedPlatform, useControl, validateButton, validateSegmented } from "./control";
import { UnavailableCheckbox, UnavailableRadioGroup } from "./checkbox-unavailable";
import { selectionIndex } from "./select";
import type { ButtonProps, CheckboxProps, RadioGroupProps, SelectProps, SegmentedControlProps, ControlKind } from "./types";
export type { ButtonProps, CheckboxProps, RadioGroupProps, TextInputProps, ControlledTextInputProps, UncontrolledTextInputProps, SelectProps, SelectOption, SegmentedControlProps, ControlProps, ControlRef, ControlKind } from "./types";
export { TextInput } from "./mobile-input";
export function getControlAvailability(control: ControlKind): Availability {
  if (!controlKinds.includes(control)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown control kind");
  if (control === "checkbox" || control === "radio-group") return unsupportedPlatform;
  return control === "text-input" || requireOptionalNativeModule("ExpoUI") ? { available: true } : { available: false, reason: "missing-module" };
}
const fill = [frame({ maxWidth: Infinity, maxHeight: Infinity })];
export function Button(props: ButtonProps) {
  validateButton(props); const control = useControl(props, macosButton(props) ? unsupportedPlatform : getControlAvailability("button"));
  const { children, onPress, variant = "default", style, testID, accessibilityLabel = children } = props;
  return <View ref={control.ref} style={[{ width: 160, height: 44 }, style]}>
    {control.failed ? <Text accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: true }} testID={testID}>{children}</Text> :
      <Host style={{ flex: 1 }}><ExpoButton label={children} onPress={() => { if (control.active()) onPress?.(); }}
        modifiers={[...fill, buttonStyle(variant === "default" ? "automatic" : variant as "bordered" | "borderless"), disabledModifier(control.disabled), labelModifier(accessibilityLabel)]} testID={testID} /></Host>}
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
      <Host style={{ flex: 1 }}><Picker key={selectionRevision} selection={selectedIndex}
        onSelectionChange={index => {
          if (!control.active()) return;
          if (!Number.isInteger(index) || !options[index]) { control.error(new SparkError("E_INVALID_DATA", "Invalid native selection")); return; }
          // Expo's SwiftUI picker retains local selection and ignores an unchanged
          // selection. A fresh picker also restores a parent-vetoed selection.
          revise(value => value + 1);
          onValueChange(options[index].value);
        }} modifiers={[pickerStyle(segmented ? "segmented" : "menu"), ...modifiers]} testID={testID}>
        {options.map((option, index) => <Option key={option.value} modifiers={[tag(index)]}>{option.label}</Option>)}
      </Picker></Host>}
  </View>;
}
export function Select(props: SelectProps) { return <Selection {...props} segmented={false} />; }
export function Checkbox(props: CheckboxProps) { return <UnavailableCheckbox {...props} availability={getControlAvailability("checkbox")} />; }
export function RadioGroup(props: RadioGroupProps) { return <UnavailableRadioGroup {...props} availability={getControlAvailability("radio-group")} />; }
/** Native mobile segmented pickers have one size and fill their frame; `size` and `distribution` keep those defaults here. */
export function SegmentedControl(props: SegmentedControlProps) { validateSegmented(props); return <Selection {...props} segmented />; }
