import { withUniwind } from "uniwind";
import { Button as NativeButton, TextInput as NativeTextInput, Select as NativeSelect, SegmentedControl as NativeSegmentedControl } from "./src/index";

// Optional, module-level bindings preserve each platform's native implementation.
// className maps to the existing layout style; explicit style wins on conflicts.
export const Button = withUniwind(NativeButton);
export const TextInput = withUniwind(NativeTextInput);
export const Select = withUniwind(NativeSelect);

export const SegmentedControl = withUniwind(NativeSegmentedControl);
