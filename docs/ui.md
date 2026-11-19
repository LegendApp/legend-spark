# Common controls

Import `Button`, `Checkbox`, `RadioGroup`, `TextInput`, `Select`, and `SegmentedControl` from `@legendapp/spark/ui`. Spark owns their props and consumer events; React Native, Expo UI and AppKit/WinUI implement the controls internally. The separate ordinary `NativeSelect` API and `/ui/select-controls` path are removed. Generated native components and their event envelopes are internal.

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

TextInput is single-line unless `multiline` is set; `placeholder` shows while it is empty. A `multiline` input is an AppKit `NSTextView` in a bezeled scroll view on macOS (a `textarea` on web, WinUI `TextBox` with `AcceptsReturn` on Windows, React Native's multiline input on mobile): Return inserts a newline, long text wraps and scrolls, and its default height is 80 pt. Switching `multiline` keeps the text. A controlled input receives `value`; an uncontrolled input receives optional `defaultValue`, read once on mount. They are mutually exclusive types. Switching modes requires a remount. Controlled desktop editing acknowledges native event counts so a render from before a keystroke cannot erase a newer edit. Returning the same controlled value restores that value after an edit. Mobile uses React Native's native TextInput for controlled editing and IME/selection handling: the pinned Expo UI fields provide an uncontrolled contract and are not exposed as Spark refs.

On macOS, `Button` and `Checkbox` take their AppKit intrinsic size (from the label and variant) unless a style sets `width` or `height`; the size arrives just after mount. Other platforms keep a fixed default button frame (Windows 160x36).

`Button`'s `variant="disclosure"` is AppKit's disclosure button (a chevron in a rounded button, no visible title). It requires a boolean `expanded`, and its text children become its accessible name; toggle `expanded` in `onPress`. A press that the parent does not apply leaves the chevron as rendered. `expanded` with any other variant throws. Disclosure buttons are macOS and web only; Windows, iOS and Android render the disabled fallback and report `E_UNSUPPORTED_PLATFORM`.

`Button`'s `symbol` shows an SF Symbol before its title, and `size` (`regular` default, `small`, `mini`) is the AppKit control size, which also sets the matching system font size. A symbol name missing on the running macOS reports `E_NOT_FOUND` through `onError` and the button keeps its title. Both are macOS options: `size` also applies on web (smaller text), while Windows, iOS and Android render the disabled fallback and report `E_UNSUPPORTED_PLATFORM` for a symbol or a size other than `regular`, and web does for a symbol. Disclosure buttons take no symbol.

```tsx
<Button symbol="sparkles" size="small" onPress={generate}>Generate</Button>
```

`Checkbox` is a controlled checkbox: `value`, `onValueChange(next)` and optional string `children` as its label (without a label, `accessibilityLabel` is required). It is an AppKit checkbox (`NSButton` switch) on macOS, a WinUI `CheckBox` on Windows (160x36 default frame, like Windows buttons) and an HTML checkbox on web; iOS and Android render the disabled fallback and report `E_UNSUPPORTED_PLATFORM`.

`RadioGroup` is a controlled group of radio buttons, one per option: `options`, `value` and `onValueChange(next)` as for Select, plus `orientation` (`vertical` default, `horizontal`) and `size` (`regular` default, `small`, `mini`). On macOS it is AppKit radio buttons (`NSButton`) in a stack with the radio-group accessibility role, sized to its buttons unless a style sets a width or height; a click the parent does not accept snaps back. Web uses HTML radio inputs; Windows, iOS and Android render the options as disabled text and report `E_UNSUPPORTED_PLATFORM`.

```tsx
<Checkbox value={amend} onValueChange={setAmend}>Amend last commit</Checkbox>
<RadioGroup orientation="horizontal" accessibilityLabel="Review" options={[{ label: 'Comment', value: 'comment' }, { label: 'Approve', value: 'approve' }, { label: 'Request changes', value: 'request' }]} value={kind} onValueChange={setKind} />
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
| Checkbox | Checkbox (`NSButton` switch) | WinUI `CheckBox` | Unsupported | Unsupported | HTML checkbox |
| RadioGroup | Radio buttons (`NSButton` radio) | Unsupported | Unsupported | Unsupported | HTML radio inputs |
| Button `disclosure` | Disclosure button | Unsupported | Unsupported | Unsupported | `aria-expanded` button |
| Button `symbol` | SF Symbol image | Unsupported | Unsupported | Unsupported | Unsupported |
| Button `size` small/mini | Control size | Unsupported | Unsupported | Unsupported | Smaller text |

SegmentedControl `size` (`regular` default, `small`) and `distribution` (`fit` default: segments sized to their labels; `fill`: equal segments across the control's width) apply on macOS and web. iOS and Android pickers have one size and fill their frame, so they keep those defaults.

Android retains inline selection instead of promising a dropdown absent from the pinned backend. Its choices use native Compose buttons, which support disabled state; the pinned Compose Picker does not. Windows has no segmented-control backend and reports that limitation explicitly.

`getControlAvailability('button' | 'text-input' | 'select' | 'segmented-control' | 'checkbox' | 'radio-group')` is a synchronous capability query. Missing or unsupported controls report `SparkError` through `onError` (default `console.error`) and render a disabled fallback containing the current label/text. Runtime host failure also uses this callback. Framework error instructions are not inserted into the application UI. Invalid props throw a shared argument/option error during render; an error boundary can handle them. Optional Expo view implementations load only when their native module is present.

`/ui/uniwind` provides the same six components with its explicit Uniwind integration. Specialized search, split-view, sidebar, glass and symbol components retain separate imports while their contracts are reviewed.

Validation includes mounted React tests for disabled controls, controlled input/selection reconciliation, invalid events, callbacks, unavailable modules, refs and mobile/web adapters. An AppKit fixture executes the actual text and selector implementations for stale edits, defaults, repeated labels and empty values. It substitutes RN bridge declarations, so it does not establish full Fabric integration. Mobile/desktop interactive UI acceptance and Windows compilation remain pending.

## Setup and native verification

Mobile applications using Button/Select install optional peer `@expo/ui@55.0.17` for Expo SDK 55. Compose requires a development build; the [shared Settings starter](universal-settings.md) includes `expo-dev-client`. Desktop and web do not load Expo UI. See [styling setup](styling.md) for optional Uniwind classes and theme configuration.

On Windows, the package supplies React Native's Appearance native module. Use `Appearance.setColorScheme('dark')`, `'light'`, or `null` to follow the system. Native theme notifications update mounted WinUI controls without recreating their editors. Native theme acceptance remains pending; see [Windows issues](windows-issues.md#foundation-work--2026-09-15).

`bun run test:ui` builds a packed kitchen-sink consumer with the test-only driver and exercises native hit targets, actions, text delegates and selection. `bun run test:universal` generates real mobile/Windows projects and bundles the Settings entry for all five targets. These are heavier integration checks than the focused tests above, and have not been rerun for this API change.

The earlier API passed packed macOS Settings/kitchen-sink checks and iPhone 17 simulator interaction on September 13, 2026; web interaction and five-target bundle checks also passed then. That historical evidence does not validate the new controlled-input and adapter behavior. Full target interaction, focus/accessibility behavior and the SwiftUI picker's remount after selection still require acceptance. The pinned SwiftUI picker ignores an unchanged selected index, so Spark remounts it after a choice to honor a parent that retains its existing value.

## Specialized macOS views

Search, sidebar, split view, swipe actions, glass, SF Symbols, progress indicators, popovers, tables and sheets keep capability-specific subpaths. They expose named props and owned events, layout refs and `onError`; generated native components are private. Availability queries are synchronous and use the shared result: `getSearchAvailability`, `getSidebarAvailability`, `getSplitViewAvailability`, `getGlassAvailability`, `getSFSymbolAvailability`, `getSwipeActionsAvailability`, `getProgressIndicatorAvailability`, `getPopoverAvailability`, `getTableAvailability`, and `getSheetAvailability`. Unsupported hosts preserve ordinary view content/layout and report through `onError`. These native implementations currently target macOS; a missing implementation is not advertised as platform parity.

On macOS these views and the controls above follow their React layout direction, including one set by a `direction: "rtl"` style on an ancestor, and update when it changes. In right to left: the split view's sidebar sits on the right and pane widths are kept; `onResize` x positions stay measured from the left edge. Segments run from the right, while option order and values are unchanged. The search field's magnifier, text and cancel button mirror. Leading swipe actions sit on the right and are revealed by a leftward swipe; a direction change closes an open row. Directional SF Symbols (such as `chevron.forward`) mirror, and text fields align right.

`TextInputSearch` under `/ui/search` is an AppKit search field with the same controlled/default-value distinction and disabled behavior as TextInput. It adds `placeholder`, explicit `appearance`, and a `TextInputSearchRef` with `focus`, `blur`, and measurement. Empty controlled values clear the field, and stale native edit counts cannot overwrite newer typing. Native arrow-key handling is left to the search field instead of unconditionally swallowing arrows. Retained refs reject after unmount.

`Sidebar` under `/ui/sidebar` is an AppKit outline view. It takes either `items: readonly { id, label, selectable?, group?, count?, children? }[]` or direct `SidebarItem` children (fragments are allowed), never both. IDs are unique nonempty strings across the tree. `selectedId` is controlled and nullable; it must reference a selectable row, and `onSelectionChange({ id, ids })` — required, since a controlled selection needs its write path — reports a requested choice or `null` for deselection. For multiple selection (⌘- and ⇧-click), pass `selectedIds: readonly string[]` instead of `selectedId` (exactly one of the two); `ids` lists every selected row in row order and `id` is the most recently selected one.

Trees: data items nest with `children`; `SidebarItem` rows nest with `parentId`, which must name an earlier row. `group: true` marks a section header: the source list's group row (11 pt semibold, secondary label color for data items), never selectable (`selectable: true` with `group` is an error); a group with children shows AppKit's Show/Hide button on hover, and other parents show a disclosure triangle. Rows start expanded. `collapsedIds` lists collapsed rows and is applied only when its value changes, so an unchanged prop never undoes the user's toggle; `onExpandedChange({ id, expanded })` reports the user's toggles (rows nested in a toggled section keep their own state and report nothing). Collapsing a section does not change the selection: rows it hides stay selected (no `onSelectionChange`), show as selected again on expand, and stay in `ids` when the user changes the visible selection in multiple-selection mode. IDs in `collapsedIds` that name no current row are kept for when the row appears. `count` (a non-negative integer) shows a trailing count in secondary-label digits, the way Mail and Finder show counts, not a capsule badge; on a `SidebarItem` the React content narrows to leave it room. `onDoubleClick({ id })` reports a double-click on any row, including group and unselectable rows. `onContentLayout({ width, height })` reports native content size separately from the standard RN `onLayout` event. `listStyle` is `'sidebar'` (default: the source list for a window's sidebar) or `'plain'`, a plain table with standard selection for lists inside content such as files or commits. Custom rows use `SidebarItem` with `id`, optional numeric/`'auto'` row height, and `onContextMenu({ id, position, windowPosition, modifiers })`. Each row takes the width of the native list's cell (inside the source-list insets, any scroller, its indentation and its count), applied after the first native layout; `'auto'` measures the row's React height at that width. Rows mirror with the React layout direction. Positions use logical top-left coordinates; windowPosition is relative to the owning window's content, suitable for a context menu with that window's explicit ID.

`SplitView` under `/ui/split-view` is a macOS `NSSplitView` for React panes. Give it a frame through `style` and pass `panes` with a unique `id` and `content` for each pane. The default `orientation="horizontal"` lays panes out left to right. `orientation="vertical"` lays them out top to bottom. AppKit draws and tracks `thin` (default), `thick`, and `paneSplitter` dividers and follows the enclosing appearance.

```tsx
import { SplitView } from '@legendapp/spark/ui/split-view';

<SplitView
  style={{ flex: 1 }}
  panes={[
    { id: 'files', content: <Files />, initialSize: 220, minSize: 160, maxSize: 360 },
    { id: 'diff', content: <Diff />, minSize: 280 },
    { id: 'comments', content: <Comments />, initialSize: 240, minSize: 180, maxSize: 400 },
  ]}
  onResize={sizes => showSizes(sizes)}
/>
```

Sizes are in points along the split axis. `initialSize` seeds each pane when its ID first appears and when the orientation changes. Unspecified panes share the available space after the initial sizes and minima. When the container resizes after a drag, the last pane absorbs the change first. Earlier panes absorb the rest as each pane reaches its bounds. If the container cannot fit the minima, the panes compress proportionally. If every pane reaches its maximum before the container is full, the last pane fills the excess. `onResize(sizes)` reports the measured sizes in pane order on initial layout and as they change. Sizes are kept for the mounted split view. To restore sizes across launches, supply your saved values as `initialSize`.

Split views can nest in each other and within `SidebarSplitView`'s `content`. On Windows and other platforms, `SplitView` reports `E_UNSUPPORTED_PLATFORM` through `onError` and uses a React Native row or column with the supplied size hints and bounds. The fallback has static panes and no divider events.

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

An optional `inspector` pane adds AppKit's inspector split item after the content (the Xcode or Keynote layout), with `inspectorWidth` (default `inspectorMinWidth`) and `inspectorMinWidth` (default 220). Like the sidebar, the user and `toggleInspector:` (a menu item or toolbar button) can collapse it: `inspectorCollapsed` is applied only when its value changes, and `onInspectorCollapsedChange(collapsed)` reports only the collapses AppKit makes itself. The inspector holds its width when the window resizes. `onResize` adds `inspectorWidth`, `inspectorHeight`, `inspectorX` and `inspectorY` (zero while absent or collapsed). Off macOS the inspector renders after the content unless collapsed.

```tsx
const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
<SidebarSplitView sidebar={<Sidebar />} content={<Thread />} inspector={<Comments />} inspectorWidth={280}
  inspectorCollapsed={inspectorCollapsed} onInspectorCollapsedChange={setInspectorCollapsed} />
```

Preferred widths (`sidebarWidth`, `listWidth`, `inspectorWidth`) seed the dividers on the first layout with enough room for them and again when those props, `list` or `inspector` presence, `sidebarCollapsed` or `inspectorCollapsed` change. Echoing current pane widths from `onResize` preserves the divider positions. Width changes during divider tracking apply after the drag. Afterwards a divider stays where the user dragged it across window resizes and re-layouts. Each native layout pass publishes one resize event with its final pane sizes. Content and list pane backgrounds are opaque in the semantic window background color (including the content pane in two-pane layouts); content is clipped to its pane. Pane content still receives its new React layout on the next commit.

AppKit can collapse the sidebar itself (View > Hide Sidebar, the sidebar toolbar button, `toggleSidebar:`). The component adopts that state, publishes a resize with the sidebar at width zero, and calls `onSidebarCollapsedChange(collapsed)`; it is not called for changes you make through `sidebarCollapsed`. Uncontrolled use needs nothing more: the sidebar stays as AppKit left it. A controlled app sets `sidebarCollapsed` from the callback, which is then a no-op natively. Only a change of the `sidebarCollapsed` value is applied: an unchanged prop never undoes a native toggle, and when a prop change arrives before a native toggle is observed, the prop change wins and no event is sent for that toggle.

`onResize` reports owned pane dimensions, each pane's origin in split-view coordinates (`sidebarX`/`sidebarY`, `contentX`/`contentY`, `listX`/`listY`, `inspectorX`/`inspectorY`; exported as `SidebarSplitViewPaneOrigins`), total `height`, and `phase: 'provisional' | 'ready'`. Panes are laid out at those origins, so `measure()` matches the screen once React layout catches up; a pane's content stays at its AppKit position even while a commit still carries an older origin. Both phases update layout. Zero dimensions remain zero, so collapsed panes cannot inherit stale sizes. Initial metrics are a mount-time hint; readiness comes from native layout. Title-bar overlay colors use `#RRGGBB` or `#RRGGBBAA`, with opacity in `[0, 1]` (default 1 when an overlay is supplied). Application-specific chrome presets are not exported.

`ProgressIndicator` under `/ui/progress` is AppKit's `NSProgressIndicator` for loading states: `variant` `bar` (default) or `spinner`, `size` (`regular` default, `small`; spinners also `mini`, since AppKit draws bars in two sizes) and `value` from 0 to 1 for determinate progress; an omitted or `null` value animates as indeterminate. A spinner takes its native size and a bar its native height (give it a width), unless a style sets them; `accessibilityLabel` names it. Values outside 0 to 1 throw during render. `getProgressIndicatorAvailability()` reports other platforms as unsupported; there the view keeps its layout and reports `E_UNSUPPORTED_PLATFORM`. For progress in a window toolbar, use a `progress` toolbar item (see the window docs).

```tsx
import { ProgressIndicator } from '@legendapp/spark/ui/progress';

<ProgressIndicator value={fetched / total} style={{ width: 160 }} accessibilityLabel="Fetching" />
<ProgressIndicator variant="spinner" size="small" />
```

`Popover` under `/ui/popover` is AppKit's `NSPopover` hosting React `content`, anchored to the popover's children or to `anchorRect` (`{ x, y, width, height }` in the view's coordinates, such as a text selection's rect). `visible` is controlled; `onClose` reports AppKit closing a visible popover (a click outside, Escape), so set `visible` to false there. `edge` is the preferred side (`bottom` default, `top`, `leading`, `trailing`; AppKit flips it when there is no room) and `behavior` is `transient` (default: any click outside closes it), `semitransient` (clicks in other windows do not) or `applicationDefined` (only `visible` closes it). The content mounts while visible and is shown at its React layout size, so give it a width; without one, text wraps to the anchor's width. Spark controls work inside it. React `Pressable`s receive clicks, but a press can cancel if the pointer moves while the button is down, because React Native measures their position in the main window; use Spark `Button`s for the popover's actions. Other platforms render only the children and report `E_UNSUPPORTED_PLATFORM`; check `getPopoverAvailability()`.

```tsx
import { Popover } from '@legendapp/spark/ui/popover';

<Popover visible={open} onClose={() => setOpen(false)} content={<CommentComposer style={{ width: 280 }} />}>
  <Button onPress={() => setOpen(true)}>Add Comment…</Button>
</Popover>
```

`Table` under `/ui/table` is AppKit's `NSTableView` with a column header, for lists with columns such as a commit history. `columns` lists `{ id, title }` with optional `width`, `minWidth`, `maxWidth`, `alignment` (`leading` default, `center`, `trailing`), `monospacedDigits` and `secondary` (the secondary label color); columns with a `width` keep it and columns without one share the remaining width; the user can resize them by dragging the header dividers. `onColumnResize({ id, width })` reports the dragged column and its width in points. `rows` are `{ id, values }`, where `values` maps column IDs to cell text (a missing value is an empty cell). AppKit creates cells only for visible rows and reuses them, so thousands of rows stay cheap; the rows are still sent as one prop, so keep the array stable between renders. Selection works like `Sidebar`: pass `selectedId` (one row, or `null`) or `selectedIds` (⌘/⇧ multiple selection); `onSelectionChange({ id, ids })` is required, and a selection the parent does not apply snaps back. Rows keep their selection by ID across updates. `onDoubleClick({ id })` reports double-clicks. `headerVisible` (default true), `alternatingRows` (instead of vertical grid lines) and `rowHeight` (default: the system row size) are optional. Cells are text; there is no sorting. Other platforms render the rows as plain text lines and report `E_UNSUPPORTED_PLATFORM`; check `getTableAvailability()`.

```tsx
import { Table } from '@legendapp/spark/ui/table';

<Table
  columns={[{ id: 'subject', title: 'Subject' }, { id: 'author', title: 'Author', width: 120, secondary: true }, { id: 'date', title: 'Date', width: 110, alignment: 'trailing', monospacedDigits: true }]}
  rows={commits.map(commit => ({ id: commit.sha, values: { subject: commit.subject, author: commit.author, date: commit.date } }))}
  selectedId={selected}
  onSelectionChange={({ id }) => setSelected(id)}
  onDoubleClick={({ id }) => checkout(id)}
/>
```

`Sheet` under `/ui/sheet` is a document-modal AppKit sheet on the window the component renders in, hosting its React children (a New Branch or Create PR form, say). Render it anywhere in the window. `visible` is controlled; the content mounts while visible and the sheet takes the content's React layout size, so give the content a width and height (or content that sizes it). Escape and ⌘. call `onCancel`; the sheet never closes itself, so set `visible` to false there and in your form's buttons. The content stays mounted through the close animation and unmounts once the sheet has closed. Closing the window ends its sheet. Spark controls work inside it; React `Pressable`s have the same pointer-movement limit as in a popover. For a single text field, `showPrompt` (an alert with a text field) is lighter. Other platforms render visible content inline and report `E_UNSUPPORTED_PLATFORM`; check `getSheetAvailability()`.

```tsx
import { Sheet } from '@legendapp/spark/ui/sheet';

<Sheet visible={creating} onCancel={() => setCreating(false)}>
  <View style={{ width: 380 }}>
    <TextInput placeholder="Branch name" value={name} onChangeText={setName} />
    <Button onPress={() => { create(name); setCreating(false); }}>Create Branch</Button>
  </View>
</Sheet>
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
