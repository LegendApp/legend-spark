# UI components

Exports: `@legendapp/spark/ui`, `/ui/uniwind`, `/ui/classnames`, `/ui/search`, `/ui/sidebar`, `/ui/split-view`, `/ui/swipe`, `/ui/glass`, `/ui/symbol`, `/ui/progress`, `/ui/popover`, `/ui/table`, `/ui/sheet`, `/webview`, `/markdown`, `/html`.

## Rules

- Use ordinary React Native views and text for layout. Spark's UI exports are a small set of native controls, not a component library.
- `Button`, `TextInput`, `Select` and `SegmentedControl` (from `/ui`, or `/ui/uniwind` for className styling) render native AppKit/WinUI controls and work on iOS/Android/web through Expo UI or React Native.
- `Checkbox` (`value`/`onValueChange`, string label children) and `Button variant="disclosure"` (requires `expanded`) are macOS and web only; check `getControlAvailability('checkbox')`. `RadioGroup` (`options`/`value`/`onValueChange` like Select, `orientation` `vertical`/`horizontal`, `size` `regular`/`small`/`mini`) is macOS (`NSButton` radios) and web only; check `getControlAvailability('radio-group')`. On macOS, buttons and checkboxes size themselves; give no fixed width unless you want one.
- `Button` takes `symbol` (an SF Symbol before the title; macOS only) and `size` (`regular`/`small`/`mini`; macOS, and web as smaller text). Elsewhere they report `E_UNSUPPORTED_PLATFORM` and render the disabled fallback; a symbol missing on the running macOS reports `E_NOT_FOUND`.
- `SegmentedControl` takes `size` (`regular`/`small`) and `distribution` (`fit`/`fill`). `Sidebar` takes `listStyle="plain"` for lists inside content.
- `TextInput` is single-line unless `multiline` (an `NSTextView` on macOS; Return inserts a newline) and takes `placeholder`. It is either controlled (`value`) or uncontrolled (`defaultValue`), never both; switching needs a remount.
- `Select`/`SegmentedControl` never auto-select the first option when `value` is missing. Values are unique strings.
- Invalid props throw during render; runtime problems go to `onError` (default `console.error`). Spark never inserts error text into your UI.
- Specialized macOS views (`TextInputSearch`, `Sidebar`, `SidebarSplitView`, swipe actions, `GlassView`, `SFSymbol`, `ProgressIndicator`, `Popover`, `Table`, `Sheet`) render plain view content on other platforms and report through `onError`. Check their `get*Availability()` before advertising the feature.
- `ProgressIndicator` (`/ui/progress`, macOS) is `NSProgressIndicator`: `variant` `bar`/`spinner`, `size` `regular`/`small` (spinners also `mini`), `value` 0 to 1 (omit or `null` for indeterminate). Give a bar a width. For toolbar progress use a `progress` toolbar item instead.
- `Popover` (`/ui/popover`, macOS) is `NSPopover` with React `content`, anchored to its children or to `anchorRect` (e.g. a text selection). `visible` is controlled; set it false in `onClose` (AppKit closed it). `edge` `bottom`/`top`/`leading`/`trailing`, `behavior` `transient`/`semitransient`/`applicationDefined`. Give the content a width.
- `Table` (`/ui/table`, macOS) is `NSTableView` with a header: `columns` (`id`, `title`, optional `width`/`minWidth`/`maxWidth`, `alignment`, `monospacedDigits`, `secondary`) and `rows` of `{ id, values }` (text cells by column ID). Only visible rows get cells. Selection like `Sidebar` (`selectedId` or `selectedIds`, required `onSelectionChange({ id, ids })`), plus `onDoubleClick({ id })`, `headerVisible`, `alternatingRows`, `rowHeight`. No sorting or custom cells.
- `Sheet` (`/ui/sheet`, macOS) is a sheet on the current window hosting React children (forms). `visible` is controlled; Escape calls `onCancel` and never closes it by itself. Give the content a size. For one text field use `showPrompt` instead.
- `SidebarSplitView` takes optional `list` (Mail's middle column) and `inspector` (a trailing, collapsible inspector item) panes; control the inspector with `inspectorCollapsed` + `onInspectorCollapsedChange`, which, like the sidebar's, reports only native toggles.
- `Sidebar`'s `selectedId` is controlled and `onSelectionChange` is required.
- `Sidebar` trees: data `children` or `SidebarItem` `parentId` nest rows; `group` makes a source-list section header (never selectable, Show/Hide on hover); `count` is a trailing count in secondary digits (not a capsule). `collapsedIds` applies when its value changes and `onExpandedChange({ id, expanded })` reports the user's toggles. `onDoubleClick({ id })` reports double-clicks. Pass `selectedIds` instead of `selectedId` for ⌘/⇧ multiple selection; `onSelectionChange` then reports `{ id, ids }`.
- Layout follows `direction: 'rtl'` on macOS controls.
- Mobile apps using `Button`/`Select` install optional peer `@expo/ui`. `@expo/ui@55.0.17`, matching Expo SDK 55.

```tsx
import { Button, Select, TextInput } from '@legendapp/spark/ui';
import { useState } from 'react';
import { View } from 'react-native';

export function Preferences() {
  const [title, setTitle] = useState('');
  const [theme, setTheme] = useState('light');
  return (
    <View>
      <TextInput value={title} onChangeText={setTitle} accessibilityLabel="Title" />
      <Select options={[{ label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }]} value={theme} onValueChange={setTheme} accessibilityLabel="Theme" />
      <Button onPress={() => console.log(title, theme)}>Save</Button>
    </View>
  );
}
```

## WebView, Markdown and HTML

- `/webview` is a Spark-owned subset over `react-native-webview@16.0.0` (WebKit on macOS, not Chromium). Upstream platform-specific props reject; import `react-native-webview` directly if you need its full surface. Nothing native is exposed to pages: define a navigation policy and expose only intended message handlers.
- `/markdown` (`Markdown`, `MarkdownInput`, `EditableMarkdown`) and `/html` need their optional peers `react-native-enriched-markdown@1.1.1` / `react-native-enriched-html@1.1.1`. They have no Windows implementation: universal apps targeting Windows exclude them in `expoByPlatform.windows.autolinking.exclude`.
- `spark doctor` reports a missing optional peer for these imports.

## Styling

Uniwind/Tailwind classes are optional (`/ui/uniwind`, `cn` from `/ui/classnames`). Theme setup is in `docs/styling.md` in the Spark repository; it is not shipped with the package.

## Platforms

`/ui` core controls: macOS, Windows (no `SegmentedControl`, `Checkbox`, `RadioGroup` or disclosure button), iOS, Android (no `Checkbox`, `RadioGroup` or disclosure button), web. Specialized `/ui/*` views: macOS only. `/webview`: macOS, Windows. `/markdown`, `/html`: macOS (and upstream mobile), not Windows.
