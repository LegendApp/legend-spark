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

Search, sidebar, split view, swipe actions, glass, SF Symbols, popover and tab view keep capability-specific subpaths. They expose named props and owned events, layout refs and `onError`; generated native components are private. Availability queries are synchronous and use the shared result: `getSearchAvailability`, `getSidebarAvailability`, `getSplitViewAvailability`, `getGlassAvailability`, `getSFSymbolAvailability`, `getSwipeActionsAvailability`, `getPopoverAvailability` and `getTabViewAvailability`. Unsupported hosts preserve ordinary view content/layout and report through `onError`, except `Popover` and `TabView`: they have no substitute and throw a `SparkError` during render (`E_UNSUPPORTED_PLATFORM`, `E_MODULE_UNAVAILABLE`, or `E_UNAVAILABLE` before macOS 14). These native implementations currently target macOS; a missing implementation is not advertised as platform parity.

On macOS these views and the controls above follow their React layout direction, including one set by a `direction: "rtl"` style on an ancestor, and update when it changes. In right to left: the split view's sidebar sits on the right and pane widths are kept; `onResize` x positions stay measured from the left edge. Segments run from the right, while option order and values are unchanged. The search field's magnifier, text and cancel button mirror. Leading swipe actions sit on the right and are revealed by a leftward swipe; a direction change closes an open row. Directional SF Symbols (such as `chevron.forward`) mirror, and text fields align right.

`TextInputSearch` from `@legendapp/spark/ui/search` is an AppKit search field with the same controlled/default-value distinction and disabled behavior as TextInput. It adds `placeholder`, explicit `appearance`, and a `TextInputSearchRef` with `focus`, `blur`, and measurement. Empty controlled values clear the field, and stale native edit counts cannot overwrite newer typing. Native arrow-key handling is left to the search field instead of unconditionally swallowing arrows. Retained refs reject after unmount.

`Sidebar` from `@legendapp/spark/ui/sidebar` takes either `items: readonly { id, label, selectable? }[]` or direct `SidebarItem` children (fragments are allowed), never both. IDs are unique nonempty strings. `selectedId` is controlled and nullable; it must reference a selectable row, and `onSelectionChange({ id })` — required, since a controlled selection needs its write path — reports a requested choice or `null` for deselection. `onContentLayout({ width, height })` reports native content size separately from the standard RN `onLayout` event. Custom rows use `SidebarItem` with `id`, optional numeric/`'auto'` row height, and `onContextMenu({ id, position, windowPosition, modifiers })`. Each row takes the width of the native list's cell (inside the source-list insets and any scroller), applied after the first native layout; `'auto'` measures the row's React height at that width. Rows mirror with the React layout direction. Positions use logical top-left coordinates; windowPosition is relative to the owning window's content, suitable for a context menu with that window's explicit ID.

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

Preferred widths (`sidebarWidth`, `listWidth`) seed the dividers on the first layout with enough room for them and again when those props, `list` presence or `sidebarCollapsed` change. Afterwards a divider stays where the user dragged it across window resizes and re-layouts. Each native layout pass publishes one resize event with its final pane sizes. Content and list pane backgrounds are opaque in the semantic window background color (including the content pane in two-pane layouts); content is clipped to its pane. Pane content still receives its new React layout on the next commit.

`onResize` reports owned pane dimensions, `contentX`, total `height`, and `phase: 'provisional' | 'ready'`. Both phases update layout. Zero dimensions remain zero, so collapsed panes cannot inherit stale sizes. Initial metrics are a mount-time hint; readiness comes from native layout. Title-bar overlay colors use `#RRGGBB` or `#RRGGBBAA`, with opacity in `[0, 1]` (default 1 when an overlay is supplied). Application-specific chrome presets are not exported.

`GlassView` under `/ui/glass` is the single native glass container, with `glassStyle: 'regular' | 'clear'` and RN `ColorValue` tint. It replaces the overlapping GlassEffectView/GlassSurface wrappers and requires macOS 26; older systems preserve children without an effect and report the host restriction. Colors use RN's standard conversion, including its dynamic/system representations.

`SFSymbol` from `@legendapp/spark/ui/symbol` retains its Apple-specific name and size/scale/offset options, accepts normal RN style arrays and accessibility props, and reports a missing OS symbol as `E_NOT_FOUND`. Its layout remains intact if no image is available. The redundant placeholder component is removed; applications can use an ordinary View for their own placeholders. `@legendapp/spark/ui/classnames` remains an explicitly library-specific `clsx`/`tailwind-merge` convenience: `cn(...inputs)` joins `ClassValue`s with `clsx` and resolves conflicting Tailwind classes with `tailwind-merge`, so the last one wins.

Specialized validation includes mounted React event/layout tests, actual AppKit search clearing/defaults and symbol error tests, and a glass implementation syntax check. Those checks substitute RN declarations and do not establish interactive Fabric, accessibility, glass tint rendering, or sidebar context-menu placement acceptance.

`SwipeActions` from `@legendapp/spark/ui/swipe` wraps a logical list row. It takes `leadingActions` (swipe right), `trailingActions` (swipe left), and a required `onAction(id)` callback. Actions have unique nonempty `id`, `title`, and SF Symbol `symbol` strings, a `#RRGGBB` or `#RRGGBBAA` `color`, and optional `dismisses` (default false). Standard RN layout/accessibility props, measurement refs, and `onError` are supported; unsupported hosts preserve the children.

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

### Popover

`Popover` from `@legendapp/spark/ui/popover` is an AppKit `NSPopover` that hosts React content. `open` is controlled: `onClose` (required) reports any close, including one the user caused by clicking outside; keep `open` true and the popover shows again. `onShow` reports that it appeared and `onDetach` that the user dragged it off into its own window (`detachable`, default false). Native events are counted and JavaScript echoes the count back, as the controls do, so an `open` value rendered before a close was processed never reopens it.

```tsx
const anchor = useRef<View>(null);
const [open, setOpen] = useState(false);
<View ref={anchor} collapsable={false}><Button onPress={() => setOpen(true)}>Details</Button></View>
<Popover open={open} anchor={{ ref: anchor }} behavior="transient" preferredEdge="bottom" onClose={() => setOpen(false)}>
  <View style={{ width: 260, padding: 16, gap: 8 }}><Text>Details</Text><TextInput defaultValue="" /></View>
</Popover>
```

- `anchor` is `{ ref, rect? }`, a React Native host view and an optional rect within it (default: its bounds), or `{ rect }` in the owning window's content. Rects are logical points from the top-left. The anchor is resolved each time the popover shows. A flattened view has no native view: give the anchor `collapsable={false}`, or anchoring reports `E_NOT_FOUND` through `onError`. A Spark `Button` ref is a layout ref, not a host view, so wrap the button.
- `behavior` is AppKit's: `transient` (default) closes on interaction anywhere outside the popover, `semi-transient` only on interaction with the anchor's window (not other apps), `application-defined` only when `open` becomes false.
- `preferredEdge` is `top`, `bottom` (default), `leading` or `trailing`, in the layout direction. AppKit uses another edge when the preferred one has no room.
- Content stays mounted while the `Popover` is, so its state survives closing and its size is known before it shows. The popover takes the size of the content's layout: give the content a width when its text should wrap. The content view is flipped, so React children are laid out top-down in React order, and it has its own touch handler, because the popover is a separate window. When it shows, keyboard focus moves to the first key view in the content (the popover window becomes key only while the app is active); AppKit returns focus to the parent window on close.
- A popover needs its anchor's window on screen: AppKit silently ignores a show from any other window. Spark then keeps it closed, reports `E_UNAVAILABLE` through `onError`, and shows it once that window comes on screen (ordered front, deminiaturized or the app unhidden) if `open` is still true. Driver-mode apps never order windows on screen ([test driver](test-driver.md)), so there the popover never opens and no capture can contain it. `e2e/flows/native-controls/popover.yaml` checks that refusal and the configuration on the driver; `popover-black-box.yaml` opens, closes and detaches it, and needs the black-box backend ([#50](https://github.com/LegendApp/legend-spark/issues/50)). `tests/ui-popover-tab-view.native.mm` drives the real component view with a recording `NSPopover`.

### Tab view

`TabView` from `@legendapp/spark/ui/tab-view` is an AppKit `NSTabView`. Its children are `Tab` elements (fragments are allowed) with unique nonempty `id`s and `label`s; each tab's React content stays mounted and is sized to AppKit's content area inside the tabs and border, which the native view measures. `selectedId` is controlled and must name a tab; `onSelectionChange({ id })` (required) reports the user's choice, and every native selection count is echoed, so a selection the parent does not adopt is restored natively.

```tsx
<TabView selectedId={tab} onSelectionChange={({ id }) => setTab(id)} tabPosition="top" style={{ height: 240 }}>
  <Tab id="general" label={t.general}><GeneralPane /></Tab>
  <Tab id="advanced" label={t.advanced}><AdvancedPane /></Tab>
</TabView>
```

`tabPosition` is `top` (default), `bottom`, `leading`, `trailing` or `none` (tabless, switched by `selectedId` only); `leading` and `trailing` follow the layout direction. `tabBorder` is `bezel` (default), `line` or `none`; AppKit draws tabs on a bezel, so `line` and `none` require `tabPosition: "none"` and otherwise throw `E_UNSUPPORTED_OPTION`. In right-to-left layouts the first tab is on the right: AppKit orders a tab row by the app's direction, so the native view reverses the row when React's direction differs. Side tabs run top to bottom in both directions.

In-process captures (the test driver's `capture`, so Kitchen Sink goldens) do not show the tab row as the window server draws it. Measured on macOS 27 with a plain `NSTabView` in a window captured through `cacheDisplayInRect:`, whether or not the window was ever on screen: in light appearance the selected tab's label is missing, and in dark appearance the row is a white bar with no labels. An `NSSegmentedControl` in the same capture draws normally. The goldens still compare the tab row's position, the selected segment and the tab content; checking the labels visually needs an out-of-process capture ([#50](https://github.com/LegendApp/legend-spark/issues/50)).

Windows is typed unsupported for both: `getPopoverAvailability()` and `getTabViewAvailability()` report `unsupported-platform` and rendering throws `E_UNSUPPORTED_PLATFORM`. [#299](https://github.com/LegendApp/legend-spark/issues/299) tracks the WinUI mapping (Flyout, TabView).

## Tables and outlines

`@legendapp/spark/ui/table` exports `Table` (AppKit `NSTableView`), `Outline` (`NSOutlineView`), `getTableAvailability()` and their named types. Both are available on macOS 14 and later. Windows, iOS, Android and web report `unsupported-platform`, and rendering either view there throws `E_UNSUPPORTED_PLATFORM` (`E_MODULE_UNAVAILABLE` when the macOS view is absent). No substitute is rendered. Windows is tracked in [#294](https://github.com/LegendApp/legend-spark/issues/294).

```tsx
import { Table, type TableSortDescriptor } from '@legendapp/spark/ui/table';

const columns = [
  { id: 'name', title: 'Name', width: 220, sortable: true },
  { id: 'size', title: 'Size', width: 100, alignment: 'trailing', sortable: true },
] as const;

function Files({ files }: { files: readonly { id: string; cells: { name: string; size: string } }[] }) {
  const [sort, setSort] = useState<TableSortDescriptor[]>([{ columnId: 'name', direction: 'ascending' }]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const rows = useMemo(() => sortFiles(files, sort), [files, sort]);
  return <Table columns={columns} rows={rows} sort={sort} onSortChange={setSort} selectionMode="multiple"
    selectedIds={selectedIds} onSelectionChange={setSelectedIds} onActivate={({ ids }) => open(ids)} style={{ flex: 1 }} />;
}
```

- **Columns:** `id`, `title`, `width` (default 120), `minWidth`, `maxWidth`, `resizable` (default true), `sortable` (default false) and `alignment` (`leading`, `center`, `trailing`; leading is the right edge in right-to-left layouts). A width prop applies when the column is created or the prop changes; until then a user resize stays.
- **Rows:** `{ id, cells }`, where `cells` maps column IDs to text. Outline rows add `children`; a row with `children` is expandable even when it is empty. IDs are unique across the whole tree. Rows are immutable: replace a row object to change it. Each row object is serialized once and cached by identity, rows travel to native in JSON chunks of 256, and native re-parses only chunks whose text changed. Sorting the same row objects serializes nothing again. AppKit's cell reuse virtualizes the rows, so 10,000 rows render only the visible cells.
- **Cells are native text.** React-rendered cells are not supported: AppKit asks for cell views synchronously while it scrolls, and React Native cannot render a component synchronously on that thread, so React cells would appear blank until JavaScript caught up, and every reused cell would need its own mounted React tree. For short lists of rich React rows, use `Sidebar` with `SidebarItem` children.
- **Sorting is controlled and done by the application.** `sort` is an array of `{ columnId, direction }`, primary key first. A header click calls `onSortChange` with AppKit's new descriptors (the clicked column first; earlier keys follow as tie-breakers). Sortable columns require `sort` and `onSortChange`.
- **Selection is controlled.** `selectionMode` is `single` (default), `multiple` or `none`. `selectedIds` and `onSelectionChange(ids)` are required unless the mode is `none`. AppKit handles click, Shift-click ranges, Command-click toggles and arrow keys with and without Shift; Command-A selects every row while the view has focus. Type-select matches the first column. Selected rows inside a collapsed outline row are not shown as selected.
- **Column layout:** users drag headers to reorder (`columnReordering`, default true) and drag edges to resize. Without `columnLayout`, the view owns widths and order and reports changes through `onColumnLayoutChange`. With `columnLayout` (an array of `{ id, width }` in display order), the layout is controlled: persist what `onColumnLayoutChange` reports, for example with `@legendapp/spark/settings`, and pass it back. Columns without an entry follow the listed ones.
- **Outline expansion is controlled:** `expandedIds` and `onExpandedChange(ids)` (IDs in display order). Option-click expands or collapses a whole branch and is reported once. An expanded row inside a collapsed parent stays in `expandedIds` and reopens with its parent. Each disclosure triangle is labelled with its row's outline column text, so VoiceOver reads which row it opens.
- **Events:** `onActivate({ ids })` for a double-click or Return, and `onContextMenu({ rowId, ids, position })` for a right- or Control-click; the view shows no menu of its own, the click does not reach ancestor views, and it leaves the selection unchanged. `ids` is the selection when the clicked row is selected, otherwise only that row. `position` is in logical points from the window content's top-left, as `showContextMenu` takes it. `rowId` is `null` below the last row.

Controlled state uses the event-count acknowledgment of the control primitives: native counts the changes it reports and reconciles `selectedIds`, `sort`, `columnLayout` and `expandedIds` only once JavaScript has processed every one of them. Props rendered before a user change never undo it, and a change the parent does not accept is restored. Native events may name rows that JavaScript has just replaced; those IDs are dropped. Invalid props throw `E_INVALID_ARGUMENT`, unknown column, row, sort and layout keys throw `E_UNSUPPORTED_OPTION`, and malformed native data is reported to `onError` as `E_INVALID_DATA`.

`tests/ui-table-native.test.ts` compiles the actual AppKit view against substituted Fabric types and checks the null-oldProps mount, columns, chunked parsing, keyboard selection ranges, sort, layout, expansion (including a user collapse that keeps expanded descendants), context menus and right-to-left layout. It is not full Fabric integration. The Kitchen Sink `native-controls/table` and `native-controls/outline` screens are, and `e2e/flows/native-controls/table*.yaml` and `outline-interaction.yaml` drive them with in-app driver input (white-box).

## Settings windows

`@legendapp/spark/settings/window` exports `SettingsWindow`, `VirtualizedSettingsWindow`, their named props, the shared `SettingsWindowPage` (`id`, `title`, `render`), and `createSettingsWindowOptions`. The options-only subpath is removed. This composition requires `@legendapp/list` as a peer and uses the macOS split-view capability.

Selection has one owner: use `selectedPageId` with `onSelectionChange`, or initialize internal selection with `defaultPageId`. Defaults apply once per mount. Pages need unique nonempty IDs and at least one page; controlled selection must identify an existing page. Removing an internally selected page selects the first remaining page. Both variants update the native title. The scrolling variant restores the selected page when a controlled parent declines a selection change.

Pass the explicit `windowId`; remount to change its owner or selection mode. The composition shows a hidden macOS window after its split layout and initial scroll are ready, and stops late completions after unmount. If the native split view is unavailable, its row-layout fallback has no native readiness event, so this composition leaves the settings window hidden. `onError` receives native/scroll failures; without it errors are logged. `SettingsRow.muted` controls visual emphasis only; disable the actual control through its own API.

The settings options helper currently uses the existing managed-window option type; it will move with the canonical window contract in the window implementation unit.
