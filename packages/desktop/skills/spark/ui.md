# UI components

Exports: `@legendapp/spark/ui`, `/ui/uniwind`, `/ui/classnames`, `/ui/search`, `/ui/sidebar`, `/ui/split-view`, `/ui/swipe`, `/ui/glass`, `/ui/symbol`, `/webview`, `/markdown`, `/html`.

## Rules

- Use ordinary React Native views and text for layout. Spark's UI exports are a small set of native controls, not a component library.
- `Button`, `TextInput`, `Select` and `SegmentedControl` (from `/ui`, or `/ui/uniwind` for className styling) render native AppKit/WinUI controls and work on iOS/Android/web through Expo UI or React Native.
- `TextInput` is single-line and either controlled (`value`) or uncontrolled (`defaultValue`), never both; switching needs a remount.
- `Select`/`SegmentedControl` never auto-select the first option when `value` is missing. Values are unique strings.
- Invalid props throw during render; runtime problems go to `onError` (default `console.error`). Spark never inserts error text into your UI.
- Specialized macOS views (`TextInputSearch`, `Sidebar`, `SidebarSplitView`, swipe actions, `GlassView`, `SFSymbol`) render plain view content on other platforms and report through `onError`. Check their `get*Availability()` before advertising the feature.
- `Sidebar`'s `selectedId` is controlled and `onSelectionChange` is required.
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

`/ui` core controls: macOS, Windows (no `SegmentedControl`), iOS, Android, web. Specialized `/ui/*` views: macOS only. `/webview`: macOS, Windows. `/markdown`, `/html`: macOS (and upstream mobile), not Windows.
