import { Text, View } from "react-native";
import type { Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { useControl, validateCheckbox } from "./control";
import type { CheckboxProps } from "./types";
/** The disabled fallback where a platform has no checkbox backend; useControl reports why through onError. */
export function UnavailableCheckbox({ availability, ...props }: CheckboxProps & { availability: Availability }) {
  validateCheckbox(props);
  const control = useControl(props, availability);
  return <View ref={control.ref} style={props.style} testID={props.testID} accessible accessibilityRole="checkbox" accessibilityLabel={props.accessibilityLabel ?? props.children} accessibilityState={{ checked: props.value, disabled: true }}><Text>{props.children}</Text></View>;
}
