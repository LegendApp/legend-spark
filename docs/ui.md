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

`bun run test:ui` builds a packed kitchen-sink consumer with the test-only driver and exercises native hit targets, actions, text delegates and selection. `bun run test:universal` generates real mobile/Windows projects and bundles the Settings entry for all five targets. These are heavier integration checks than the focused tests above, and have not been rerun for this API change.

The earlier API passed packed macOS Settings/kitchen-sink checks and iPhone 17 simulator interaction on September 13, 2026; web interaction and five-target bundle checks also passed then. That historical evidence does not validate the new controlled-input and adapter behavior. Full target interaction, focus/accessibility behavior and the SwiftUI picker's remount after selection still require acceptance. The pinned SwiftUI picker ignores an unchanged selected index, so Spark remounts it after a choice to honor a parent that retains its existing value.

## Specialized macOS views

Search, sidebar, split view, glass and SF Symbols keep capability-specific subpaths. They expose named props and owned events, layout refs and `onError`; generated native components are private. Availability queries are synchronous and use the shared result: `getSearchAvailability`, `getSidebarAvailability`, `getSplitViewAvailability`, `getGlassAvailability`, and `getSFSymbolAvailability`. Unsupported hosts preserve ordinary view content/layout and report through `onError`. These native implementations currently target macOS; a missing implementation is not advertised as platform parity.

`TextInputSearch` under `/ui/search` is an AppKit search field with the same controlled/default-value distinction and disabled behavior as TextInput. It adds `placeholder`, explicit `appearance`, and a `TextInputSearchRef` with `focus`, `blur`, and measurement. Empty controlled values clear the field, and stale native edit counts cannot overwrite newer typing. Native arrow-key handling is left to the search field instead of unconditionally swallowing arrows. Retained refs reject after unmount.

`Sidebar` under `/ui/sidebar` takes either `items: readonly { id, label, selectable? }[]` or direct `SidebarItem` children (fragments are allowed), never both. IDs are unique nonempty strings. `selectedId` is controlled and nullable; it must reference a selectable row, and `onSelectionChange({ id })` — required, since a controlled selection needs its write path — reports a requested choice or `null` for deselection. `onContentLayout({ width, height })` reports native content size separately from the standard RN `onLayout` event. Custom rows use `SidebarItem` with `id`, optional numeric/`'auto'` row height, and `onContextMenu({ id, position, windowPosition, modifiers })`. Positions use logical top-left coordinates; windowPosition is relative to the owning window's content, suitable for a context menu with that window's explicit ID.

`SidebarSplitView` under `/ui/split-view` uses named `sidebar` and `content` panes, rather than interpreting child positions. It retains width/minimum/collapsed settings and initial pane metrics. Title-bar customization is grouped:

```tsx
<SidebarSplitView
  sidebar={<Navigation />}
  content={<Editor />}
  titleBar={{ content: { height: 52, material: 'glass', overlay: { color: '#ffffff', opacity: 0.1 } } }}
  onResize={event => {
    if (event.phase === 'ready') showPreparedWindow();
  }}
/>
```

An optional `list` pane adds AppKit's content-list column between sidebar and content (the Mail layout: mailboxes | messages | message) inside the same native split view, with `listWidth` and `listMinWidth`. Prefer it over nesting a second `SidebarSplitView` in `content`: a nested split only learns its frame after the outer split's metrics round-trip through React, so every outer divider drag resizes it a commit late and its panes tear. Sidebar and list hold their widths when the window resizes; the content column absorbs the change. `onResize` adds `listWidth`, `listHeight` and `listX` (zero without a list).

Preferred widths (`sidebarWidth`, `listWidth`) seed the dividers on first layout and again only when those props, `list` presence or `sidebarCollapsed` change. Afterwards a divider stays where the user dragged it across window resizes and re-layouts. Each native layout pass publishes one resize event with its final pane sizes.

AppKit can collapse the sidebar itself (View > Hide Sidebar, the sidebar toolbar button, `toggleSidebar:`). The component adopts that state, publishes a resize with the sidebar at width zero, and calls `onSidebarCollapsedChange(collapsed)`; it is not called for changes you make through `sidebarCollapsed`. Uncontrolled use needs nothing more: the sidebar stays as AppKit left it. A controlled app sets `sidebarCollapsed` from the callback, which is then a no-op natively. Only a change of the `sidebarCollapsed` value is applied: an unchanged prop never undoes a native toggle, and when a prop change arrives before a native toggle is observed, the prop change wins and no event is sent for that toggle.

`onResize` reports owned pane dimensions, `contentX`, total `height`, and `phase: 'provisional' | 'ready'`. Both phases update layout. Zero dimensions remain zero, so collapsed panes cannot inherit stale sizes. Initial metrics are a mount-time hint; readiness comes from native layout. Title-bar overlay colors use `#RRGGBB` or `#RRGGBBAA`, with opacity in `[0, 1]` (default 1 when an overlay is supplied). Application-specific chrome presets are not exported.

`GlassView` under `/ui/glass` is the single native glass container, with `glassStyle: 'regular' | 'clear'` and RN `ColorValue` tint. It replaces the overlapping GlassEffectView/GlassSurface wrappers and requires macOS 26; older systems preserve children without an effect and report the host restriction. Colors use RN's standard conversion, including its dynamic/system representations.

`SFSymbol` under `/ui/symbol` retains its Apple-specific name and size/scale/offset options, accepts normal RN style arrays and accessibility props, and reports a missing OS symbol as `E_NOT_FOUND`. Its layout remains intact if no image is available. The redundant placeholder component is removed; applications can use an ordinary View for their own placeholders. `/ui/classnames` remains an explicitly library-specific `clsx`/`tailwind-merge` convenience.

Specialized validation includes mounted React event/layout tests, actual AppKit search clearing/defaults and symbol error tests, and a glass implementation syntax check. Those checks substitute RN declarations and do not establish interactive Fabric, accessibility, glass tint rendering, or sidebar context-menu placement acceptance.

## Settings windows

`@legendapp/spark/settings/window` exports `SettingsWindow`, `VirtualizedSettingsWindow`, their named props, the shared `SettingsWindowPage` (`id`, `title`, `render`), and `createSettingsWindowOptions`. The options-only subpath is removed. This composition requires `@legendapp/list` as a peer and uses the macOS split-view capability.

Selection has one owner: use `selectedPageId` with `onSelectionChange`, or initialize internal selection with `defaultPageId`. Defaults apply once per mount. Pages need unique nonempty IDs and at least one page; controlled selection must identify an existing page. Removing an internally selected page selects the first remaining page. Both variants update the native title. The scrolling variant restores the selected page when a controlled parent declines a selection change.

Pass the explicit `windowId`; remount to change its owner or selection mode. The composition shows a hidden macOS window after its split layout and initial scroll are ready, and stops late completions after unmount. If the native split view is unavailable, its row-layout fallback has no native readiness event, so this composition leaves the settings window hidden. `onError` receives native/scroll failures; without it errors are logged. `SettingsRow.muted` controls visual emphasis only; disable the actual control through its own API.

The settings options helper currently uses the existing managed-window option type; it will move with the canonical window contract in the window implementation unit.
