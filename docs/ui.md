# Common controls

Import `Button`, `TextInput`, `Select`, and `SegmentedControl` from `@legendapp/spark/ui`. Spark owns their props and consumer events; React Native, Expo UI and AppKit/WinUI implement the controls internally. The separate ordinary `NativeSelect` API and `/ui/select-controls` path are removed. Generated native components and their event envelopes are internal.

All controls accept `disabled`, `accessibilityLabel`, `testID`, layout `style`, `onError`, and a `ref` to `ControlRef`. The ref exposes only `measureInWindow(callback)`, in React Native logical coordinates. A retained ref rejects after unmount; it does not expose backend objects, text setters, or a focus API that every backend cannot support. Button labels default to their text children. Layout styles size the native control; they do not restyle all OS chrome.

```tsx
import { Button, Select, TextInput } from '@legendapp/spark/ui';

<TextInput value={title} onChangeText={setTitle} accessibilityLabel="Title" />
<TextInput defaultValue="Initial value" onChangeText={saveDraft} />
<Select
  options={[{ label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }]}
  value={theme}
  onValueChange={setTheme}
  accessibilityLabel="Theme"
/>
<Button onPress={save} disabled={saving}>Save</Button>
```

TextInput is single-line. A controlled input receives `value`; an uncontrolled input receives optional `defaultValue`, read once on mount. They are mutually exclusive types. Switching modes requires a remount. Controlled desktop editing acknowledges native event counts so a render from before a keystroke cannot erase a newer edit. Returning the same controlled value restores that value after an edit. Mobile uses React Native's native TextInput for controlled editing and IME/selection handling: the pinned Expo UI fields provide an uncontrolled contract and are not exposed as Spark refs.

Select and SegmentedControl use the same `SelectOption` array and controlled `value`/`onValueChange`. Values are unique strings, including an empty string if desired; labels are nonempty strings and may repeat. There is no implicit selection of the first option when the requested value is missing. A native selection callback reports only a validated value, and a parent that retains its current value retains that selection.

| Control | macOS | Windows | iOS | Android | React Native Web |
| --- | --- | --- | --- | --- | --- |
| Button | AppKit | WinUI | Expo SwiftUI | Expo Compose | HTML button |
| TextInput | AppKit | WinUI | RN TextInput | RN TextInput | HTML input |
| Select | Popup | ComboBox | Menu picker | Inline choices | HTML select |
| SegmentedControl | Segmented control | Unsupported | Segmented picker | Inline choices | Button group |

Android retains inline selection instead of promising a dropdown absent from the pinned backend. Its choices use native Compose buttons, which support disabled state; the pinned Compose Picker does not. Windows has no segmented-control backend and reports that limitation explicitly.

`getControlAvailability('button' | 'text-input' | 'select' | 'segmented-control')` is a synchronous capability query. Missing or unsupported controls report `SparkError` through `onError` (default `console.error`) and render a disabled fallback containing the current label/text. Runtime host failure also uses this callback. Framework error instructions are not inserted into the application UI. Invalid props throw a shared argument/option error during render; an error boundary can handle them. Optional Expo view implementations load only when their native module is present.

`/ui/uniwind` provides the same four components with its explicit Uniwind integration. Specialized search, split-view, sidebar, glass and symbol components retain separate imports while their contracts are reviewed.

Validation includes mounted React tests for disabled controls, controlled input/selection reconciliation, invalid events, callbacks, unavailable modules, refs and mobile/web adapters. An AppKit fixture executes the actual text and selector implementations for stale edits, defaults, repeated labels and empty values. It substitutes RN bridge declarations, so it does not establish full Fabric integration. Mobile/desktop interactive UI acceptance and Windows compilation remain pending.

## Setup and native verification

Mobile applications using Button/Select install optional peer `@expo/ui@0.2.0-beta.9` for Expo 54. Compose requires a development build; the [shared Settings starter](universal-settings.md) includes `expo-dev-client`. Desktop and web do not load Expo UI. See [styling setup](styling.md) for optional Uniwind classes and theme configuration.

On Windows, the package supplies React Native's Appearance native module. Use `Appearance.setColorScheme('dark')`, `'light'`, or `null` to follow the system. Native theme notifications update mounted WinUI controls without recreating their editors. Native theme acceptance remains pending; see [Windows issues](windows-issues.md#foundation-work--2026-09-15).

`npm run test:ui` builds a packed kitchen-sink consumer with the test-only driver and exercises native hit targets, actions, text delegates and selection. `npm run test:universal` generates real mobile/Windows projects and bundles the Settings entry for all five targets. These are heavier integration checks than the focused tests above, and have not been rerun for this API change.

The earlier API passed packed macOS Settings/kitchen-sink checks and iPhone 17 simulator interaction on September 13, 2026; web interaction and five-target bundle checks also passed then. That historical evidence does not validate the new controlled-input and adapter behavior. Full target interaction, focus/accessibility behavior and the SwiftUI picker's remount after selection still require acceptance. The pinned SwiftUI picker ignores an unchanged selected index, so Spark remounts it after a choice to honor a parent that retains its existing value.
