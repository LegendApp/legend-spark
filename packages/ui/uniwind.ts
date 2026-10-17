import { withUniwind } from "uniwind";
import { Button as NativeButton, TextInput as NativeTextInput, Select as NativeSelect, SegmentedControl as NativeSegmentedControl } from "./src/index";

// Optional, module-level bindings preserve each platform's native implementation.
// className maps to the existing layout style; explicit style wins on conflicts.
/** `Button` with Uniwind `className` support. */
export const Button = withUniwind(NativeButton);
/** `TextInput` with Uniwind `className` support. */
export const TextInput = withUniwind(NativeTextInput);
/** `Select` with Uniwind `className` support. */
export const Select = withUniwind(NativeSelect);

/** `SegmentedControl` with Uniwind `className` support. */
export const SegmentedControl = withUniwind(NativeSegmentedControl);
