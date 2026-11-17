# Common controls

Import `Button`, `Checkbox`, `TextInput`, `Select`, and `SegmentedControl` from `@legendapp/spark/ui`. Spark owns their props and consumer events; React Native, Expo UI and AppKit/WinUI implement the controls internally. The separate ordinary `NativeSelect` API and `/ui/select-controls` path are removed. Generated native components and their event envelopes are internal.

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

On macOS, `Button` and `Checkbox` take their AppKit intrinsic size (from the label and variant) unless a style sets `width` or `height`; the size arrives just after mount. Other platforms keep a fixed default button frame (Windows 160x36).

`Button`'s `variant="disclosure"` is AppKit's disclosure button (a chevron in a rounded button, no visible title). It requires a boolean `expanded`, and its text children become its accessible name; toggle `expanded` in `onPress`. A press that the parent does not apply leaves the chevron as rendered. `expanded` with any other variant throws. Disclosure buttons are macOS and web only; Windows, iOS and Android render the disabled fallback and report `E_UNSUPPORTED_PLATFORM`.

`Button`'s `symbol` shows an SF Symbol before its title, and `size` (`regular` default, `small`, `mini`) is the AppKit control size, which also sets the matching system font size. A symbol name missing on the running macOS reports `E_NOT_FOUND` through `onError` and the button keeps its title. Both are macOS options: `size` also applies on web (smaller text), while Windows, iOS and Android render the disabled fallback and report `E_UNSUPPORTED_PLATFORM` for a symbol or a size other than `regular`, and web does for a symbol. Disclosure buttons take no symbol.

```tsx
<Button symbol="sparkles" size="small" onPress={generate}>Generate</Button>
```

`Checkbox` is a controlled checkbox: `value`, `onValueChange(next)` and optional string `children` as its label (without a label, `accessibilityLabel` is required). It is an AppKit checkbox (`NSButton` switch) on macOS and an HTML checkbox on web; Windows, iOS and Android render the disabled fallback and report `E_UNSUPPORTED_PLATFORM`.

```tsx
<Checkbox value={amend} onValueChange={setAmend}>Amend last commit</Checkbox>
<Button variant="disclosure" expanded={open} onPress={() => setOpen(!open)}>Details</Button>
<SegmentedControl size="small" distribution="fill" options={modes} value={mode} onValueChange={setMode} />
```

Select and SegmentedControl use the same `SelectOption` array and controlled `value`/`onValueChange`. Values are unique strings, including an empty string if desired; labels are nonempty strings and may repeat. There is no implicit selection of the first option when the requested value is missing. A native selection callback reports only a validated value, and a parent that retains its current value retains that selection.

| Control | macOS | Windows | iOS | Android | React Native Web |
| --- | --- | --- | --- | --- | --- |
| Button | AppKit | WinUI | Expo SwiftUI | Expo Compose | HTML button |
| TextInput | AppKit | WinUI | RN TextInput | RN TextInput | HTML input |
| Select | Popup | ComboBox | Menu picker | Inline choices | HTML select |
| SegmentedControl | Segmented control | Unsupported | Segmented picker | Inline choices | Button group |
| Checkbox | Checkbox (`NSButton` switch) | Unsupported | Unsupported | Unsupported | HTML checkbox |
| Button `disclosure` | Disclosure button | Unsupported | Unsupported | Unsupported | `aria-expanded` button |
| Button `symbol` | SF Symbol image | Unsupported | Unsupported | Unsupported | Unsupported |
| Button `size` small/mini | Control size | Unsupported | Unsupported | Unsupported | Smaller text |

SegmentedControl `size` (`regular` default, `small`) and `distribution` (`fit` default: segments sized to their labels; `fill`: equal segments across the control's width) apply on macOS and web. iOS and Android pickers have one size and fill their frame, so they keep those defaults.

Android retains inline selection instead of promising a dropdown absent from the pinned backend. Its choices use native Compose buttons, which support disabled state; the pinned Compose Picker does not. Windows has no segmented-control backend and reports that limitation explicitly.

`getControlAvailability('button' | 'text-input' | 'select' | 'segmented-control' | 'checkbox')` is a synchronous capability query. Missing or unsupported controls report `SparkError` through `onError` (default `console.error`) and render a disabled fallback containing the current label/text. Runtime host failure also uses this callback. Framework error instructions are not inserted into the application UI. Invalid props throw a shared argument/option error during render; an error boundary can handle them. Optional Expo view implementations load only when their native module is present.

`/ui/uniwind` provides the same five components with its explicit Uniwind integration. Specialized search, split-view, sidebar, glass and symbol components retain separate imports while their contracts are reviewed.

Validation includes mounted React tests for disabled controls, controlled input/selection reconciliation, invalid events, callbacks, unavailable modules, refs and mobile/web adapters. An AppKit fixture executes the actual text and selector implementations for stale edits, defaults, repeated labels and empty values. It substitutes RN bridge declarations, so it does not establish full Fabric integration. Mobile/desktop interactive UI acceptance and Windows compilation remain pending.

## Setup and native verification

Mobile applications using Button/Select install optional peer `@expo/ui@55.0.17` for Expo SDK 55. Compose requires a development build; the [shared Settings starter](universal-settings.md) includes `expo-dev-client`. Desktop and web do not load Expo UI. See [styling setup](styling.md) for optional Uniwind classes and theme configuration.

On Windows, the package supplies React Native's Appearance native module. Use `Appearance.setColorScheme('dark')`, `'light'`, or `null` to follow the system. Native theme notifications update mounted WinUI controls without recreating their editors. Native theme acceptance remains pending; see [Windows issues](windows-issues.md#foundation-work--2026-09-15).

`bun run test:ui` builds a packed kitchen-sink consumer with the test-only driver and exercises native hit targets, actions, text delegates and selection. `bun run test:universal` generates real mobile/Windows projects and bundles the Settings entry for all five targets. These are heavier integration checks than the focused tests above, and have not been rerun for this API change.

The earlier API passed packed macOS Settings/kitchen-sink checks and iPhone 17 simulator interaction on September 13, 2026; web interaction and five-target bundle checks also passed then. That historical evidence does not validate the new controlled-input and adapter behavior. Full target interaction, focus/accessibility behavior and the SwiftUI picker's remount after selection still require acceptance. The pinned SwiftUI picker ignores an unchanged selected index, so Spark remounts it after a choice to honor a parent that retains its existing value.

## Specialized macOS views

Search, sidebar, split view, swipe actions, glass, SF Symbols and progress indicators keep capability-specific subpaths. They expose named props and owned events, layout refs and `onError`; generated native components are private. Availability queries are synchronous and use the shared result: `getSearchAvailability`, `getSidebarAvailability`, `getSplitViewAvailability`, `getGlassAvailability`, `getSFSymbolAvailability`, `getSwipeActionsAvailability`, and `getProgressIndicatorAvailability`. Unsupported hosts preserve ordinary view content/layout and report through `onError`. These native implementations currently target macOS; a missing implementation is not advertised as platform parity.

On macOS these views and the controls above follow their React layout direction, including one set by a `direction: "rtl"` style on an ancestor, and update when it changes. In right to left: the split view's sidebar sits on the right and pane widths are kept; `onResize` x positions stay measured from the left edge. Segments run from the right, while option order and values are unchanged. The search field's magnifier, text and cancel button mirror. Leading swipe actions sit on the right and are revealed by a leftward swipe; a direction change closes an open row. Directional SF Symbols (such as `chevron.forward`) mirror, and text fields align right.

`TextInputSearch` under `/ui/search` is an AppKit search field with the same controlled/default-value distinction and disabled behavior as TextInput. It adds `placeholder`, explicit `appearance`, and a `TextInputSearchRef` with `focus`, `blur`, and measurement. Empty controlled values clear the field, and stale native edit counts cannot overwrite newer typing. Native arrow-key handling is left to the search field instead of unconditionally swallowing arrows. Retained refs reject after unmount.

`Sidebar` under `/ui/sidebar` is an AppKit outline view. It takes either `items: readonly { id, label, selectable?, group?, count?, children? }[]` or direct `SidebarItem` children (fragments are allowed), never both. IDs are unique nonempty strings across the tree. `selectedId` is controlled and nullable; it must reference a selectable row, and `onSelectionChange({ id, ids })` — required, since a controlled selection needs its write path — reports a requested choice or `null` for deselection. For multiple selection (⌘- and ⇧-click), pass `selectedIds: readonly string[]` instead of `selectedId` (exactly one of the two); `ids` lists every selected row in row order and `id` is the most recently selected one.

Trees: data items nest with `children`; `SidebarItem` rows nest with `parentId`, which must name an earlier row. `group: true` marks a section header: the source list's group row (11 pt semibold, secondary label color for data items), never selectable (`selectable: true` with `group` is an error); a group with children shows AppKit's Show/Hide button on hover, and other parents show a disclosure triangle. Rows start expanded. `collapsedIds` lists collapsed rows and is applied only when its value changes, so an unchanged prop never undoes the user's toggle; `onExpandedChange({ id, expanded })` reports the user's toggles (rows nested in a toggled section keep their own state and report nothing). Collapsing a section does not change the selection: rows it hides stay selected (no `onSelectionChange`), show as selected again on expand, and stay in `ids` when the user changes the visible selection in multiple-selection mode. IDs in `collapsedIds` that name no current row are kept for when the row appears. `count` (a non-negative integer) shows a trailing count in secondary-label digits, the way Mail and Finder show counts, not a capsule badge; on a `SidebarItem` the React content narrows to leave it room. `onDoubleClick({ id })` reports a double-click on any row, including group and unselectable rows. `onContentLayout({ width, height })` reports native content size separately from the standard RN `onLayout` event. `listStyle` is `'sidebar'` (default: the source list for a window's sidebar) or `'plain'`, a plain table with standard selection for lists inside content such as files or commits. Custom rows use `SidebarItem` with `id`, optional numeric/`'auto'` row height, and `onContextMenu({ id, position, windowPosition, modifiers })`. Each row takes the width of the native list's cell (inside the source-list insets, any scroller, its indentation and its count), applied after the first native layout; `'auto'` measures the row's React height at that width. Rows mirror with the React layout direction. Positions use logical top-left coordinates; windowPosition is relative to the owning window's content, suitable for a context menu with that window's explicit ID.

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

An optional `list` pane adds AppKit's content-list column between sidebar and content (the Mail layout: mailboxes | messages | message) inside the same native split view, with `listWidth` and `listMinWidth`. Prefer it over nesting a second `SidebarSplitView` in `content`: a nested split only learns its frame after the outer split's metrics round-trip through React, so every outer divider drag resizes it a commit late and its panes tear. Sidebar and list hold their widths when the window resizes; the content column absorbs the change. `onResize` adds `listWidth`, `listHeight`, `listX` and `listY` (zero without a list).

Preferred widths (`sidebarWidth`, `listWidth`) seed the dividers on the first layout with enough room for them and again when those props, `list` presence or `sidebarCollapsed` change. Afterwards a divider stays where the user dragged it across window resizes and re-layouts. Each native layout pass publishes one resize event with its final pane sizes. Content and list pane backgrounds are opaque in the semantic window background color (including the content pane in two-pane layouts); content is clipped to its pane. Pane content still receives its new React layout on the next commit.

AppKit can collapse the sidebar itself (View > Hide Sidebar, the sidebar toolbar button, `toggleSidebar:`). The component adopts that state, publishes a resize with the sidebar at width zero, and calls `onSidebarCollapsedChange(collapsed)`; it is not called for changes you make through `sidebarCollapsed`. Uncontrolled use needs nothing more: the sidebar stays as AppKit left it. A controlled app sets `sidebarCollapsed` from the callback, which is then a no-op natively. Only a change of the `sidebarCollapsed` value is applied: an unchanged prop never undoes a native toggle, and when a prop change arrives before a native toggle is observed, the prop change wins and no event is sent for that toggle.

`onResize` reports owned pane dimensions, each pane's origin in split-view coordinates (`sidebarX`/`sidebarY`, `contentX`/`contentY`, `listX`/`listY`; exported as `SidebarSplitViewPaneOrigins`), total `height`, and `phase: 'provisional' | 'ready'`. Panes are laid out at those origins, so `measure()` matches the screen once React layout catches up; a pane's content stays at its AppKit position even while a commit still carries an older origin. Both phases update layout. Zero dimensions remain zero, so collapsed panes cannot inherit stale sizes. Initial metrics are a mount-time hint; readiness comes from native layout. Title-bar overlay colors use `#RRGGBB` or `#RRGGBBAA`, with opacity in `[0, 1]` (default 1 when an overlay is supplied). Application-specific chrome presets are not exported.

`ProgressIndicator` under `/ui/progress` is AppKit's `NSProgressIndicator` for loading states: `variant` `bar` (default) or `spinner`, `size` (`regular` default, `small`; spinners also `mini`, since AppKit draws bars in two sizes) and `value` from 0 to 1 for determinate progress; an omitted or `null` value animates as indeterminate. A spinner takes its native size and a bar its native height (give it a width), unless a style sets them; `accessibilityLabel` names it. Values outside 0 to 1 throw during render. `getProgressIndicatorAvailability()` reports other platforms as unsupported; there the view keeps its layout and reports `E_UNSUPPORTED_PLATFORM`. For progress in a window toolbar, use a `progress` toolbar item (see the window docs).

```tsx
import { ProgressIndicator } from '@legendapp/spark/ui/progress';

<ProgressIndicator value={fetched / total} style={{ width: 160 }} accessibilityLabel="Fetching" />
<ProgressIndicator variant="spinner" size="small" />
```

`GlassView` under `/ui/glass` is the single native glass container, with `glassStyle: 'regular' | 'clear'` and RN `ColorValue` tint. It replaces the overlapping GlassEffectView/GlassSurface wrappers and requires macOS 26; older systems preserve children without an effect and report the host restriction. Colors use RN's standard conversion, including its dynamic/system representations.

`SFSymbol` under `/ui/symbol` retains its Apple-specific name and size/scale/offset options, accepts normal RN style arrays and accessibility props, and reports a missing OS symbol as `E_NOT_FOUND`. Its layout remains intact if no image is available. The redundant placeholder component is removed; applications can use an ordinary View for their own placeholders. `/ui/classnames` remains an explicitly library-specific `clsx`/`tailwind-merge` convenience.

Specialized validation includes mounted React event/layout tests, actual AppKit search clearing/defaults and symbol error tests, and a glass implementation syntax check. Those checks substitute RN declarations and do not establish interactive Fabric, accessibility, glass tint rendering, or sidebar context-menu placement acceptance.

`SwipeActions` under `/ui/swipe` wraps a logical list row. It takes `leadingActions` (swipe right), `trailingActions` (swipe left), and a required `onAction(id)` callback. Actions have unique nonempty `id`, `title`, and SF Symbol `symbol` strings, a `#RRGGBB` or `#RRGGBBAA` `color`, and optional `dismisses` (default false). Standard RN layout/accessibility props, measurement refs, and `onError` are supported; unsupported hosts preserve the children.

```tsx
<SwipeActions
  key={`${message.id}:${resetRevision}`}
  style={{ height: 64 }}
  trailingActions={[
    { id: 'delete', title: 'Delete', symbol: 'trash.fill', color: '#C2362F', dismisses: true },
    { id: 'snooze', title: 'Snooze', symbol: 'clock.fill', color: '#D18F25' },
  ]}
  onAction={id => handleAction(id, message.id)}
>
  <MessageRow message={message} />
</SwipeActions>
```

Phased trackpad events lock to an axis; buffered vertical events pass through to the enclosing scroll view. A partial horizontal swipe rests open, and opening another row closes the previous row. The first action on each side is outermost and can commit on a full swipe, beyond both the arming threshold and the resting buttons. Resting buttons fit within the row; when all available width is needed for them, use their buttons rather than full-swipe commit. A cancelled gesture closes without acting. Clicking open content closes it, while action buttons support mouse clicks and accessibility presses. A private clipping container keeps the reveal within the row independently of RN overflow styles; Reduce Motion shortens animations.

A non-dismissing action reports as the row begins springing closed. A dismissing action reports after the row slides away and leaves that native view dismissed. The caller must remove the row, or remount it with a new React key to recover after failure or undo. In a JS-recycling list, key `SwipeActions` by the logical item ID so another item gets a fresh native owner; increment a reset revision to restore the same item. Fabric recycling and replacing action definitions reset native position and invalidate delayed completions, preventing an obsolete action from reaching a replacement owner.

The swipe AppKit fixture runs the actual implementation for axis replay, rest/arm/cancel, clicks, accessibility presses, clipping ownership, child coordinates, recycling and delayed callbacks. Its Fabric transport declarations are substituted; it is distinct from full Fabric integration and platform release acceptance.

## Settings windows

`@legendapp/spark/settings/window` exports `SettingsWindow`, `VirtualizedSettingsWindow`, their named props, the shared `SettingsWindowPage` (`id`, `title`, `render`), and `createSettingsWindowOptions`. The options-only subpath is removed. This composition requires `@legendapp/list` as a peer and uses the macOS split-view capability.

Selection has one owner: use `selectedPageId` with `onSelectionChange`, or initialize internal selection with `defaultPageId`. Defaults apply once per mount. Pages need unique nonempty IDs and at least one page; controlled selection must identify an existing page. Removing an internally selected page selects the first remaining page. Both variants update the native title. The scrolling variant restores the selected page when a controlled parent declines a selection change.

Pass the explicit `windowId`; remount to change its owner or selection mode. The composition shows a hidden macOS window after its split layout and initial scroll are ready, and stops late completions after unmount. If the native split view is unavailable, its row-layout fallback has no native readiness event, so this composition leaves the settings window hidden. `onError` receives native/scroll failures; without it errors are logged. `SettingsRow.muted` controls visual emphasis only; disable the actual control through its own API.

The settings options helper currently uses the existing managed-window option type; it will move with the canonical window contract in the window implementation unit.
