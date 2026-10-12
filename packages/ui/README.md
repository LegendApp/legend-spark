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
| `DatePicker` / `date-picker` | `value`: Unix timestamp in milliseconds. `mode='date' \| 'time' \| 'date-time'` (default `date`; time shows hours and minutes), `variant='text-field-stepper' \| 'text-field' \| 'clock-calendar'` (`clock-calendar` is a calendar for dates and an analog clock for times, side by side for `date-time`), optional `min`/`max` (milliseconds; the picker never proposes a value outside them), `locale` (BCP 47; default the system locale), `calendar` (a Unicode calendar name such as `gregory`, `islamic-umalqura` or `japanese`; default the locale's calendar) and `timeZone` (IANA; default the system zone). A locale, calendar or zone Foundation does not know is reported through `onError` as `E_INVALID_ARGUMENT` and the last valid configuration stays. Native text and graphical pickers are sized to fit at the leading edge. |
| `ColorWell` / `color-well` | `value`: sRGB hex `#rrggbb`, or `#rrggbbaa` with `alpha`. `alpha` (default false) lets the user choose opacity; then every reported value carries the alpha byte. `variant='default' \| 'minimal' \| 'expanded'`: `default` opens the system color panel, `minimal` and `expanded` the system popover. Colors from other color spaces (Display P3, catalog colors) report their sRGB form; a pattern color, which has none, is reported through `onError` as `E_INVALID_DATA`. Reported values are lowercase. In test driver mode, activating a well reports `E_UNAVAILABLE` through `onError` instead of showing the panel. |

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

## Text services

`@legendapp/spark/ui/text-services` covers AppKit text services in React Native `TextInput`,
selectable `Text` and Spark `TextInput`. `getTextServicesAvailability(feature)` is
synchronous:

| Feature | macOS | Windows and other platforms |
| --- | --- | --- |
| `services` | Available. Selected text offers the Services menu (app menu and context menu), and a service's returned text replaces the selection and reaches `onChangeText`. AppKit's text views do this; there is no Spark call. | `unsupported-platform` |
| `lookUp` | Available with the native module. Look Up and Force Click are built in; `lookUp(target)` shows the definition for the selection, or the word at the insertion point. | `unsupported-platform` |
| `writingTools` | Available on macOS 15.2+ hardware that supports Writing Tools, even when the user has not turned it on; `host-restriction` otherwise. | `unsupported-platform` |
| `findBar` | Available with the native module. Multiline `TextInput`s show the NSTextFinder find bar for Edit > Find (⌘F), with its own case and wrap options; `showFindBar(target)` and `findText(target, query, options)`. | `unsupported-platform` |

`missing-module` means the macOS build lacks the text services module. Writing Tools is
set per React Native `TextInput` with `writingToolsBehavior`: `"default"`, `"complete"`
(inline), `"limited"` (panel) or `"none"` (opted out). Spark's config plugin adds the prop
on macOS (see [Expo Desktop integration](../../docs/expo-desktop-integration.md)); other
platforms ignore it. `complete` and `limited` are preferences the system applies when it can.

```tsx
import { useRef, useState } from 'react';
import { Button, TextInput } from 'react-native';
import { findText, getTextServicesAvailability, type FindTextResult } from '@legendapp/spark/ui/text-services';

function Note() {
  const note = useRef<TextInput>(null);
  const [found, setFound] = useState<FindTextResult>();
  return <>
    <TextInput ref={note} multiline writingToolsBehavior="limited" defaultValue="Spark notes" />
    <TextInput writingToolsBehavior="none" placeholder="License key" />
    {getTextServicesAvailability('findBar').available && <Button title="Find next" onPress={() => findText(note.current, 'spark').then(setFound)} />}
  </>;
}
```

`findText` counts the non-overlapping substring matches of `query` in the whole text and
selects the next one after the selection, scrolling it into view. It resolves
`{ matchCount, matchIndex }`, where `matchIndex` is the 1-based position of the selected
match, or 0 when nothing was selected. Options: `caseSensitive` (default `false`), `wrap`
(continue from the other end, default `true`) and `backwards` (select the match before the
selection). Unknown option keys reject with `E_UNSUPPORTED_OPTION`. `showFindBar` focuses the
input and shows its find bar. It rejects with `E_INVALID_ARGUMENT` for a view without one,
such as selectable `Text`. All three operations reject with `E_INVALID_ARGUMENT` for a target
without a text view (a single-line `TextInput`), with `E_NOT_FOUND` for an unmounted target,
and with `E_UNSUPPORTED_PLATFORM` off macOS. Windows support is tracked in
[#293](https://github.com/LegendApp/legend-spark/issues/293).

## Color and font panels

The system color and font panels are app-wide singletons, so each `show` call returns a
session that owns its panel until it ends. These are plain functions; no component needs to
be mounted.

```ts
import { getColorPanelAvailability, sampleScreenColor, showColorPanel, showFontPanel } from '@legendapp/spark/ui';

const colors = await showColorPanel({ color: '#3366cc', alpha: true, mode: 'wheel', onChange: ({ color }) => apply(color), onClose: ({ reason }) => {} });
await colors.close();

if (getColorPanelAvailability('sampler').available) {
  const picked = await sampleScreenColor(); // { canceled: true } | { canceled: false, color: '#rrggbb' }
}

const fonts = await showFontPanel({ font: { family: 'Helvetica Neue', size: 14, weight: 700 }, onChange: ({ font }) => use(font) });
fonts.font; // { family, postScriptName, size, weight, italic }: the installed font the panel opened with
```

- `showColorPanel({ color?, alpha?, mode?, onChange, onClose? })` shows the panel and
  resolves once it is configured. Omitted `color` and `mode` keep the panel's own. `mode` is
  `wheel`, `rgb`, `hsb`, `cmyk`, `gray`, `palettes`, `image` or `pencils`. Every change is
  `onChange({ color })` in the same hex form as `ColorWell`.
- `showFontPanel({ font, onChange, onClose? })` takes a `FontDescriptor` (`family`, `size` in
  points, `weight` 100 to 900 in steps of 100, default 400, `italic`). The nearest installed
  weight and style are used; a family that is not installed rejects with `E_NOT_FOUND`, never
  a substitute. Each change is `onChange({ font })` with a `ResolvedFont`.
- A session ends with `onClose({ reason: 'dismissed' })` when the user closes the panel, or
  `'replaced'` when a newer session or an activated `ColorWell` takes the panel. `close()`
  stops callbacks at once, hides the panel if this session still owns it, and is idempotent;
  after a native failure it can be retried. A session that has already ended closes nothing.
  While a font session is open, font changes go to it rather than to the focused text view:
  the panel's own, and the Format › Font menu actions (Bold, Italic, Bigger, Smaller), which
  the shared font manager routes to the same target. Text views get them again once it ends.
- When JavaScript reloads, open sessions end without `onClose` and their panels are hidden.
- `sampleScreenColor()` shows the system eyedropper (`NSColorSampler`). The user picks one
  on-screen color (opaque `#rrggbb`) or presses Escape (`{ canceled: true }`). Apple documents
  it as needing no Screen Recording permission: the app receives only the chosen color. A
  second call while the user is still sampling rejects with `E_BUSY`, also after a JavaScript
  reload, which rejects the earlier call with `E_CLOSED`: AppKit cannot dismiss a sampler.
- In test driver mode ([docs/test-driver.md](../../docs/test-driver.md)) nothing may reach the
  screen, so `showColorPanel`, `showFontPanel` and `sampleScreenColor` reject with
  `E_UNAVAILABLE` after validating their arguments. Availability still reports the app's
  capability.
- `getColorPanelAvailability(feature?: 'sampler')` and `getFontPanelAvailability()` are
  synchronous. Calls reject with `E_UNSUPPORTED_PLATFORM` off macOS and `E_MODULE_UNAVAILABLE`
  when the native module is absent. Unknown option keys reject with `E_UNSUPPORTED_OPTION`.

Windows is typed unsupported for the pickers and panels: WinUI has `CalendarDatePicker`,
`TimePicker` and `ColorPicker`, but no shared color or font panel and no eyedropper.
[#298](https://github.com/LegendApp/legend-spark/issues/298) tracks the mapping and
implementation.
