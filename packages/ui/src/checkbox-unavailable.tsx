import { Text, View } from "react-native";
import type { Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { useControl, validateCheckbox, validateRadioGroup } from "./control";
import type { CheckboxProps, ControlRef, RadioGroupProps } from "./types";
/** The disabled fallback where a platform has no checkbox backend; useControl reports why through onError. */
export function UnavailableCheckbox({ availability, ...props }: CheckboxProps & { availability: Availability }) {
  validateCheckbox(props);
  const control = useControl(props, availability);
  return <View ref={control.ref} style={props.style} testID={props.testID} accessible accessibilityRole="checkbox" accessibilityLabel={props.accessibilityLabel ?? props.children} accessibilityState={{ checked: props.value, disabled: true }}><Text>{props.children}</Text></View>;
}
/** The disabled fallback for RadioGroup: the options as text, the selected one marked for accessibility. */
export function UnavailableRadioGroup({ availability, ...props }: RadioGroupProps & { availability: Availability }) {
  validateRadioGroup(props);
  return <RadioGroupFallback {...props} controlRef={useControl(props, availability).ref} />;
}
export function RadioGroupFallback({ controlRef, ...props }: RadioGroupProps & { controlRef: (value: ControlRef | null) => void }) {
  return <View ref={controlRef} style={[{ flexDirection: props.orientation === "horizontal" ? "row" : "column", gap: 6 }, props.style]} testID={props.testID} accessibilityRole="radiogroup" accessibilityLabel={props.accessibilityLabel}>
    {props.options.map(option => <Text key={option.value} accessibilityRole="radio" accessibilityState={{ checked: option.value === props.value, disabled: true }}>{option.label}</Text>)}
  </View>;
}
