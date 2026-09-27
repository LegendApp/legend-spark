import type { TextInputProps, SelectProps, ControlRef } from "../packages/ui/src/types";
const controlled: TextInputProps = { value: "hello", onChangeText: value => { value.toUpperCase(); } };
const uncontrolled: TextInputProps = { defaultValue: "hello" };
// @ts-expect-error A control has one value owner.
const ambiguous: TextInputProps = { value: "hello", defaultValue: "world" };
// @ts-expect-error Ordinary Select uses disabled/onValueChange, never enabled/onChange.
const oldSelect: SelectProps = { enabled: true, options: [{ label: "One", value: "one" }], value: "one", onChange: () => {} };
function ownedRef(ref: ControlRef) {
  ref.measureInWindow((x, y, width, height) => { [x, y, width, height].forEach(Number.isFinite); });
  // @ts-expect-error Backend commands are not public ref methods.
  ref.setNativeProps({});
}
void [controlled, uncontrolled, ambiguous, oldSelect, ownedRef];
