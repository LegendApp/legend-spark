# Native controls

Import controls and their named prop types from `@legendapp/spark/ui`. macOS
primitives render AppKit controls. `getControlAvailability(kind)` returns
`{ available: true }`, or `{ available: false, reason }`. Check availability before
rendering. These primitives throw `SparkError` synchronously during render with
`E_UNSUPPORTED_PLATFORM` on Windows, iOS, Android and web, or
`E_MODULE_UNAVAILABLE` when the macOS native view is absent. No substitute is ever
rendered.

Windows is typed unsupported for now. WinUI has close equivalents for most of the
family (CheckBox, RadioButtons, ToggleSwitch, Slider, NumberBox, ComboBox,
ProgressBar and ProgressRing). It has none for the token field, level indicator, bare
disclosure triangle or control sizes. The WinUI code has not been written: it can only
be compiled and checked on Windows, and the Windows test backend does not exist yet.
[#228](https://github.com/LegendApp/legend-spark/issues/228) tracks the mapping and
implementation.

```tsx
import { Checkbox, Slider, Progress, getControlAvailability } from '@legendapp/spark/ui';
import { useState } from 'react';

function Controls() {
  const [enabled, setEnabled] = useState<boolean | 'mixed'>('mixed');
  const [level, setLevel] = useState(40);
  if (!getControlAvailability('checkbox').available) return null;
  return <>
    <Checkbox value={enabled} onValueChange={setEnabled} label="Enable processing" size="small" />
    <Slider value={level} onValueChange={setLevel} min={0} max={100} step={5} ticks={5} continuous />
    <Progress value={level / 100} accessibilityLabel="Processing progress" />
  </>;
}
```

Every primitive accepts `size="mini" | "small" | "regular" | "large"` (default
`regular`), `disabled`, `accessibilityLabel`, `style`, `testID`, `onError`, and a
layout-only `ref` with `measureInWindow`. Native chrome follows the system
appearance; `style` controls the frame. A label on Checkbox, Switch or
DisclosureTriangle also supplies its default accessibility label. Supply an
explicit accessibility label for controls without visible labels.

Interactive primitives are controlled: `value` is authoritative and
`onValueChange(value)` proposes an edit. If the parent retains its value, the
native control restores it. Edits made while JavaScript is still processing earlier
events are kept: typing in a combo box, dragging a continuous slider or editing
tokens is never reset by an older value. Disabled and unmounted controls stop delivering
events. Unknown props throw `E_UNSUPPORTED_OPTION`, including keys set to `undefined`.
Invalid prop values throw `E_INVALID_ARGUMENT`; invalid native event values
are rejected with `E_INVALID_DATA` through `onError`. Application callback errors
propagate to the application. Availability failures throw even when `onError` is
provided.

| Component / availability kind | Value and options |
| --- | --- |
| `Checkbox` / `checkbox` | `boolean \| 'mixed'`; optional `label`. Native activation toggles the state. |
| `RadioGroup` / `radio-group` | String `value`; nonempty `options: {label, value}[]` with unique values. The value must match an option. Horizontal native radio buttons. |
| `Switch` / `switch` | Boolean `value`; optional `label` supplies accessibility text (NSSwitch has no visible title). |
| `Slider` / `slider` | Numeric `value`, `min=0`, `max=100`, `step=1`, `ticks=0`, `continuous=true`. With `continuous=false`, dragging reports the final value; otherwise it reports intermediate values. Ticks accept integers from 0 to 1000. They are visual marks, while `step` governs increments. |
| `Stepper` / `stepper` | Numeric `value`, `min=0`, `max=100`, `step=1`. |
| `ComboBox` / `combo-box` | String `value` and `options: string[]`; supports typed text outside the suggestions. |
| `TokenField` / `token-field` | `value: readonly string[]`; change callback receives a string array when native token edits commit. |
| `PathControl` / `path-control` | File URL `value`, such as `file:///Users`; selecting a path component proposes its URL. |
| `Progress` / `progress` | `{mode?: 'determinate', value: number}` with value in `[0, 1]`, or `{mode: 'indeterminate' \| 'spinner'}` without a value. Read-only. |
| `LevelIndicator` / `level-indicator` | Read-only numeric `value`, `min=0`, `max=100`. |
| `DisclosureTriangle` / `disclosure-triangle` | Boolean expanded `value`; optional `label` supplies accessibility text (the native triangle has no visible title). Default frame is square, one control height wide. The application owns the disclosed content and its visible heading. |

Numeric ranges require finite values, `min < max`, positive `step`, and a value
inside the range. Radio options reuse the ordinary Select validation contract.
There is no uncontrolled primitive mode. No new public import path or imperative
resource is needed: these components are inherently React views.

The internal `SparkPrimitive` bridge shares `kind`, `controlSize`, `disabled`,
`valueJson`, and an `eventCount`. Configuration is serialized once. Native events
contain only the raw proposed JSON value and the view's running event count.
JavaScript echoes the latest count it has processed, including for rejected or vetoed
edits. Native applies `valueJson` only when the echoed count has caught up with its
own, as `TextInput` does. Restores never replace the native view, so focus and editing
state survive. A value that cannot be serialized as JSON, or configuration JSON that
does not parse, is reported through `onError` as `E_INVALID_DATA`. The control keeps
its last valid state. Future native control families can reuse that boundary without publishing
backend-specific props.

`Button` accepts `variant="default" | "push" | "bevel" | "toolbar" | "help" |
"cancel" | "destructive" | "bordered" | "borderless"` and the same `size` values.
Without a `variant`, a macOS button is a plain push button. Only an explicit
`variant="default"` makes it the window's default button: AppKit gives it the Return
key and accent styling. `cancel` activates with Escape, and `destructive` uses the
system destructive color. Native bezel styles and size-specific fonts remain
OS-owned. Use `getButtonAvailability({ variant, size })` before rendering a specific
style.

On other platforms, an omitted variant, `default`, `bordered` and `borderless`
(without an explicit size) keep their existing behavior. `default` does not throw
there. The AppKit-only styles (`push`, `bevel`, `toolbar`, `help`, `cancel`,
`destructive`) and explicit sizes throw `E_UNSUPPORTED_PLATFORM`. An absent macOS
button manager throws `E_MODULE_UNAVAILABLE`. Unknown availability option keys throw
`E_UNSUPPORTED_OPTION`.
