import { TextInput as RNTextInput } from "react-native";
import { useControl, useTextValue } from "./control";
import type { TextInputProps } from "./types";
/** RN owns text editing, IME, controlled-value reconciliation and selection on mobile. */
export function TextInput(props: TextInputProps) {
  const control = useControl(props), state = useTextValue(props);
  return <RNTextInput ref={control.ref} value={state.controlled ? state.text : undefined} defaultValue={state.defaultText}
    onChangeText={text => { if (control.active()) props.onChangeText?.(text); }} editable={!control.disabled} multiline={false}
    accessibilityLabel={props.accessibilityLabel} accessibilityState={{ disabled: control.disabled }} testID={props.testID}
    style={[{ width: 240, height: 44, borderWidth: 1, borderColor: "#8e8e93", borderRadius: 6, paddingHorizontal: 8 }, props.style]} />;
}
