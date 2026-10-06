# Styling with Uniwind

React Native `style` remains the framework's styling contract. Uniwind is an optional application dependency that adds Tailwind classes; importing `@legendapp/spark/ui` does not load it. The universal Settings starter includes Uniwind 1.6.3 and Tailwind CSS 4.2.4, following the setup in legend-apps. It continues to use the pinned Expo 54 / Expo Desktop beta toolchain.

## Application setup

New universal projects are already configured. To add the same setup to a universal project that uses spark's Metro factory:

```sh
npm install uniwind@1.6.3 tailwindcss@4.2.4
```

```js
// metro.config.js
const { withUniwindConfig } = require('uniwind/metro');
const { metroConfig } = require('@legendapp/spark/metro');

module.exports = withUniwindConfig(metroConfig(__dirname), {
  cssEntryFile: './global.css',
  dtsFile: './uniwind-types.d.ts',
});
```

Wrap your final Metro configuration with `withUniwindConfig`. Existing Expo projects should keep their own configuration and apply this wrapper after any spark composition. Uniwind supplies the CSS transformer and React Native component mapping; spark still delegates platform defaults to Expo or Expo Desktop. spark adds the missing `react-native` package export conditions for macOS/Windows to the pinned Metro defaults, preventing desktop imports from selecting a web runtime. No additional Babel preset or custom styling runtime is needed.

Import `./global.css` once, before application imports in the root entry. Begin that file with:

```css
@layer theme, base, components, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);
@import 'uniwind';
```

The starter omits Tailwind Preflight because React Native Web supplies its own reset and Preflight removes browser-native form control chrome.

Keep the generated `uniwind-types.d.ts` in the application's TypeScript includes. Define theme tokens in the application's CSS, as the Settings starter does. Tailwind scans relative to that CSS file; use `@source` for shared source directories outside that root. Restart Metro with a cleared cache when first adding the transformer.

## Kitchen sink

`bun run kitchen-sink` also configures Uniwind while preserving the desktop runtime Metro integration. The header native button cycles System → Light → Dark → System. Every launch begins in System; the selection is shared by React windows in the current JavaScript runtime and is not persisted. Cards, text, editors, status colors, drag targets, and the embedded WebView demo follow the theme. All application action buttons use `@legendapp/spark/ui/uniwind`; the embedded HTML demo retains its browser button. API actions add example-local pending, result, and error feedback below the native button, so responses remain visible without scrolling to the event log. Repeat presses are disabled while an action is pending; the framework Button contract is unchanged. Each event-driven demo also keeps its six most recent events beside the controls: window/file/link activity, menu and shortcut actions, notification responses, tray/Dock choices, update progress, drag/drop, process output, and WebView messages. Process stdout/stderr is decoded as streaming UTF-8; the full event log retains the shared history. The native-controls demo shows its remount count.

## Components

Ordinary React Native views and text accept classes through Uniwind:

```tsx
import { View, Text } from 'react-native';
import { Button, TextInput } from '@legendapp/spark/ui/uniwind';

<View className="gap-3 rounded-xl bg-surface p-4">
  <Text className="text-xl font-semibold text-foreground">Profile</Text>
  <TextInput className="w-full" defaultValue="" onChangeText={setName} />
  <Button className="w-full sm:w-56" onPress={save}>Save changes</Button>
</View>
```

The optional `/ui/uniwind` entry exports `Button`, `TextInput`, and `Select` wrapped once with upstream `withUniwind` on native platforms. Web uses Uniwind's `useResolveClassNames` so responsive classes override inline default frames correctly. It retains each platform's native backend and original props, adding `className` for its `style` prop. Explicit `style` takes precedence over classes, so measured sizes and dynamic values can remain ordinary React Native styles.

For these native controls, classes allocate the **layout spark**. Use their documented props for native chrome; `text-*`, rounded corners, and background classes do not imply arbitrary styling of the internal AppKit, WinUI, SwiftUI, or Compose control. Style surrounding views/text with classes. Windows fallbacks receive the same spark styles.

## Appearance and responsive layout

Settings defines application-owned background, surface, foreground, muted, and border colors under Uniwind's light/dark variants. Its preference selector calls `Uniwind.setTheme('light' | 'dark' | 'system')`. Uniwind updates its style subscribers and calls React Native Appearance for native chrome; the Windows UI adapter applies manual appearance overrides to its WinUI controls, with native acceptance pending (see [known Windows issues](windows-issues.md)). Browser CSS `color-scheme` keeps HTML controls consistent. Preferences are currently in memory.

Use standard spacing, size, and responsive utilities for static layout. The Settings panel has a maximum width, reduced padding on narrow viewports, and buttons that stack at small widths. Keep dynamic/measured styles in `style`; there is no framework theme provider or parallel token system.

## Verification

`bun run test:universal [fresh-directory]` packs the SDK, generates the native projects, and bundles this starter for all five targets. It checks platform UI adapters, Uniwind's web/native runtime selection, and preservation of CSS/configuration and earlier generated projects when switching platforms. Native execution is a separate check; see the [Settings guide](universal-settings.md) and [known Windows issues](windows-issues.md).

## Recorded validation — 2026-09-14

- Workspace and generated consumer TypeScript checks passed; 157 unit/codegen tests passed.
- The kitchen sink passed all six native UI checks. A separate AppKit action check exercised its real header button through System → Light → Dark → System, verifying the native hit target, 288-point spark, label updates, app colors, and native Appearance.
- A fresh packed consumer generated iOS, Android, and Windows projects and bundled Settings for all five targets. Shared CSS, manifests, Metro configuration, and prior generated projects were preserved. Desktop bundles select Uniwind's native runtime.
- The iOS simulator app built and ran. Native text entry, light/dark/system menu selection, copying preferences, and the themed native controls were checked interactively.
- Browser input and theme change events passed. At 1100 pixels wide, button frames were 224 pixels; at 500 pixels, they stacked at 434 pixels with no horizontal overflow. Browser controls retain native chrome because the starter omits Tailwind Preflight.
- macOS native compilation and runtime smoke checks passed: Settings mounted, responsive classes resolved to a 224-point button width, and light/dark/system changes updated tokens and native Appearance. Visual/pointer acceptance was blocked by the locked Mac desktop. Android and Windows native execution remain pending; Windows manual native appearance propagation is tracked in [Windows acceptance](windows-issues.md).

Checks ran from the synchronized temporary checkout because Bun stalls under Documents on this machine. Generated consumers and evidence remain outside source control.

The Windows UI package now overrides that native Appearance module to implement
manual Light/Dark and reset-to-System for its WinUI controls. Uniwind requires no
Windows-specific theme call. The implementation preserves existing controls and
text; visual/native Windows acceptance remains pending in
[Windows appearance acceptance](windows-issues.md). OS dialog/title-bar theming and arbitrary RNW
PlatformColor resources are not covered by this change.
