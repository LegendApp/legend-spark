import type { ComponentProps } from "react";
type Compose = typeof import("@expo/ui/jetpack-compose");
const compose = () => require("@expo/ui/jetpack-compose") as Compose;
const buttons = { default: "Button", bordered: "OutlinedButton", borderless: "TextButton" } as const;
function ExpoButton({ variant, label, ...props }: Omit<ComponentProps<Compose["Button"]>, "children"> & { variant: keyof typeof buttons; label: string }) {
  const { Host, Text, [buttons[variant]]: Component } = compose();
  return <Host style={{ flex: 1 }}><Component {...props}><Text>{label}</Text></Component></Host>;
}
function Segments({ labels, selected, enabled, onSelect }: { labels: string[]; selected: number; enabled: boolean; onSelect: (index: number) => void }) {
  const { Host, Text, SingleChoiceSegmentedButtonRow, SegmentedButton } = compose();
  const { selectable } = require("@expo/ui/jetpack-compose/modifiers") as typeof import("@expo/ui/jetpack-compose/modifiers");
  return <Host style={{ flex: 1 }}><SingleChoiceSegmentedButtonRow>{labels.map((label, index) =>
    <SegmentedButton key={index} selected={index === selected} enabled={enabled} onClick={() => onSelect(index)}
      modifiers={[selectable(index === selected, () => onSelect(index), "radioButton")]}><SegmentedButton.Label><Text>{label}</Text></SegmentedButton.Label></SegmentedButton>)}
  </SingleChoiceSegmentedButtonRow></Host>;
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
  if (!["button", "text-input", "select", "segmented-control"].includes(control)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown control kind");
  return control === "text-input" || requireOptionalNativeModule("ExpoUI") ? { available: true } : { available: false, reason: "missing-module" };
}
export function Button(props: ButtonProps) {
  validateButton(props); const control = useControl(props, getControlAvailability("button"));
  const { children, onPress, variant = "default", style, testID, accessibilityLabel = children } = props;
  return <View ref={control.ref} style={[{ width: 160, height: 48 }, style]} testID={testID} accessibilityLabel={accessibilityLabel}>
    {control.failed ? <Text accessibilityState={{ disabled: true }}>{children}</Text> :
      <ExpoButton onClick={() => { if (control.active()) onPress?.(); }} enabled={!control.disabled} variant={variant} label={children} />}
  </View>;
}
function Selection(props: SelectProps) {
  const selected = selectionIndex(props.options, props.value);
  if (typeof props.onValueChange !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected onValueChange");
  const control = useControl(props, getControlAvailability("select"));
  return <View ref={control.ref} style={[{ width: 280, minHeight: 48, flexDirection: "row" }, props.style]} testID={props.testID} accessibilityLabel={props.accessibilityLabel}>
    {control.failed ? <Text accessibilityState={{ disabled: true }}>{props.options[selected].label}</Text> :
      <Segments labels={props.options.map(option => option.label)} selected={selected} enabled={!control.disabled}
        onSelect={index => { if (control.active()) props.onValueChange(props.options[index].value); }} />}
  </View>;
}
/** Android presents its choices inline; there is no dropdown backend in the pinned Expo UI. */
export function Select(props: SelectProps) { return <Selection {...props} />; }
export function SegmentedControl(props: SegmentedControlProps) { return <Selection {...props} />; }
