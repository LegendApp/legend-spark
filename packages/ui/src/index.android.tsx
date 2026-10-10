import type { ComponentProps } from "react";
type Compose = typeof import("@expo/ui/jetpack-compose");
const compose = () => require("@expo/ui/jetpack-compose") as Compose;
function Host(props: ComponentProps<Compose["Host"]>) {
  const Component = compose().Host;
  return <Component {...props} />;
}
function ComposeButton({ variant, ...props }: ComponentProps<Compose["Button"]> & { variant: NonNullable<ButtonProps["variant"]> }) {
  const ui = compose();
  const Component = variant === "bordered" ? ui.OutlinedButton : variant === "borderless" ? ui.TextButton : ui.Button;
  return <Component {...props} />;
}
function ComposeText(props: ComponentProps<Compose["Text"]>) {
  const Component = compose().Text;
  return <Component {...props} />;
}
import { fillMaxSize, semantics } from "@expo/ui/jetpack-compose/modifiers";
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
  return <View ref={control.ref} style={[{ width: 160, height: 48 }, style]} testID={testID}>
    {control.failed ? <Text accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: true }}>{children}</Text> :
      <Host style={{ flex: 1 }}><ComposeButton variant={variant} enabled={!control.disabled} onClick={() => { if (control.active()) onPress?.(); }}
        modifiers={[fillMaxSize(), semantics({ contentDescription: accessibilityLabel })]}><ComposeText>{children}</ComposeText></ComposeButton></Host>}
  </View>;
}
function Selection(props: SelectProps) {
  const selected = selectionIndex(props.options, props.value);
  if (typeof props.onValueChange !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected onValueChange");
  const control = useControl(props, getControlAvailability("select"));
  return <View ref={control.ref} style={[{ width: 280, minHeight: 48, flexDirection: "row" }, props.style]} testID={props.testID} accessibilityLabel={props.accessibilityLabel}>
    {control.failed ? <Text accessibilityState={{ disabled: true }}>{props.options[selected].label}</Text> : props.options.map(option =>
      <View key={option.value} style={{ flex: 1 }} accessible accessibilityRole="radio" accessibilityLabel={option.label}
        accessibilityState={{ checked: option.value === props.value, disabled: control.disabled }}>
        <Host style={{ flex: 1 }}><ComposeButton variant={option.value === props.value ? "bordered" : "borderless"} enabled={!control.disabled}
          onClick={() => { if (control.active()) props.onValueChange(option.value); }} modifiers={[fillMaxSize()]}><ComposeText>{option.label}</ComposeText></ComposeButton></Host>
      </View>)}
  </View>;
}
/** Android presents its choices inline; there is no dropdown backend in the pinned Expo UI. */
export function Select(props: SelectProps) { return <Selection {...props} />; }
export function SegmentedControl(props: SegmentedControlProps) { return <Selection {...props} />; }
