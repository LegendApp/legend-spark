# Displays

`@legendapp/spark/displays` reports every connected display in detail and tells you when the
display configuration changes. It complements `getDisplays()` in `@legendapp/spark/windows`,
which keeps the portable subset that window geometry uses.

```ts
import { addDisplayListener, getDisplayAvailability, getDisplayDetails } from '@legendapp/spark/displays';

if (getDisplayAvailability().available) {
  const displays = await getDisplayDetails();
  const main = displays.find(display => display.primary)!;
  const frameRate = main.refreshRate.maximum;          // 120 on ProMotion, 60 on a fixed 60 Hz panel
  const hdr = main.edrHeadroom.potential > 1;

  const registration = await addDisplayListener(({ displays, added, removed, changed }) => {
    if (changed.some(change => change.fields.includes('refreshRate'))) retuneAnimations(displays);
  });
  // Later, at the owner's shutdown:
  await registration.remove();
}
```

## Details

`DisplayDetails` extends the window API's `DisplayInfo` (`id`, `persistentId`, `name`, `primary`,
`size`, `workArea`, `scaleFactor`, in logical units) with:

| Field | Meaning | macOS source |
| --- | --- | --- |
| `origin` | Top-left of the display in the arrangement, in logical units from the primary display's top-left, Y downward. A display to the left has a negative `x`; one above has a negative `y`. | `NSScreen.frame` |
| `safeArea` | `{ top, left, bottom, right }` insets clear of the camera housing (notch). `top` was 32 on a 16-inch MacBook Pro at its default 1728 × 1117; zero on displays without a notch. | `NSScreen.safeAreaInsets` |
| `refreshRate` | `{ minimum, maximum, variable }` in Hz, rounded to 0.01. If AppKit reports a refresh interval that is not positive, there is no rate to report, and the call (or event) rejects with `E_INVALID_DATA` instead of inventing one. | `1 / maximumRefreshInterval`, `1 / minimumRefreshInterval` |
| `colorSpace` | `{ name, gamut }`. `name` is the display profile's name as AppKit localizes it ("Color LCD" in English, "LCD ملونة" in Arabic), so show it but don't match on it; `null` if the profile has none. `gamut` is `"p3"` when the display can show Display P3 and `"srgb"` otherwise: P3-capable or not, not a measured gamut. | `NSScreen.colorSpace.localizedName`, `canRepresentDisplayGamut:` |
| `edrHeadroom` | `{ current, potential, reference }`, the largest color component value where 1 is SDR white, rounded to 0.01. | `maximum…ExtendedDynamicRangeColorComponentValue` |

### Refresh rate

A fixed-rate display reports one rate, for example `{ minimum: 60, maximum: 60, variable: false }`
for a 60 Hz panel such as the M1 MacBook Air's or a 60 Hz external display. A ProMotion panel (14- and
16-inch MacBook Pro) varies its rate with content and reports the range it can run at. Measured on a
16-inch MacBook Pro (M4 Max, macOS 27): `{ minimum: 24, maximum: 120, variable: true }`. The values
come from AppKit's refresh intervals for the display's current mode, so a fixed rate picked in System
Settings > Displays, or an adaptive-sync external display, reports whatever AppKit reports for that mode.
Those cases, and the M1 MacBook Air itself, have not been measured.

`variable` is always `minimum < maximum`; a native report that disagrees is rejected as
`E_INVALID_DATA` rather than passed on. The current instantaneous rate of a ProMotion panel is not
reported: it changes frame by frame with content, so it is not a display property. Use the frame
callbacks of your rendering layer for that.

### EDR headroom

`potential` is what the display can reach (16 on the Liquid Retina XDR panel; 1 means no EDR).
`current` is what is available now: it follows brightness and whether content on screen requested
EDR, so it can change without any display setting changing. `reference` is the headroom in a
reference (fixed brightness) preset, or `null` when the display has none.

## Change events

`addDisplayListener(listener, options?)` resolves once native observation runs. Each event carries
the full new `displays` list and the difference from the previous one:

```ts
interface DisplayChangeEvent {
  displays: DisplayDetails[];
  added: DisplayId[];                                // connected
  removed: DisplayId[];                              // disconnected
  changed: { id: DisplayId; fields: DisplayField[] }[];
}
```

| What happened | Reported as |
| --- | --- |
| A display connects or disconnects | `added`, `removed` (other displays may also report `origin` or `primary`) |
| Displays are rearranged | `origin` |
| The primary (menu bar) display changes | `primary` and `origin` on the displays involved |
| Resolution or "looks like" size changes | `size`, `workArea`, and `scaleFactor` when the backing scale changes |
| Dock or menu bar changes | `workArea` |
| Refresh rate changes (ProMotion on or off, a new mode) | `refreshRate` |
| Color profile changes | `colorSpace` |
| EDR headroom changes | `edrHeadroom` |

A listener only hears changes: notifications that leave every display the same are dropped, and so
is any notification older than the listener's own starting snapshot. Removal stops callbacks
immediately; native observation stops with the last listener in the runtime. A listener that throws,
or a malformed native event, is reported to `onError` (default `console.error`).

### Relation to `onSystemEvent("displaysChanged")`

`onSystemEvent` in `@legendapp/spark/system` also reports `{ type: "displaysChanged" }` (macOS: screen parameter changes; Windows: `WM_DISPLAYCHANGE`). That event has no payload and no difference: it says only that something about the displays may have changed, and it works on Windows. `addDisplayListener` uses its own native event (`displayDetailsChanged`), so neither stream reaches the other's listeners. Use `onSystemEvent` for a cheap "re-measure" signal; use `addDisplayListener` for what changed.

On macOS the sources are `NSApplicationDidChangeScreenParametersNotification` (connect, disconnect,
arrangement, resolution, scale, work area and EDR headroom), `NSScreenColorSpaceDidChangeNotification`
and Core Graphics display reconfiguration callbacks (display modes, including refresh rate).

## Simulated displays

The in-app test driver ([test-driver.md](test-driver.md)) can replace what this API reports:
`{"command": "simulateDisplays", "displays": [DisplayDetails, …]}` makes `getDisplayDetails` return
exactly those displays and reports the change to listeners, and `"displays": null` restores the
real ones. Flows use it as `simulateDisplays: { displays: [...] }` and
`simulateDisplays: { restore: true }` ([e2e-flow-commands.md](e2e-flow-commands.md)). It exists only in
driver mode and changes nothing in the OS: no resolution, arrangement or refresh rate changes, and no
display sleep. Every display needs a unique `id`, `primary` (exactly one), `origin`, a positive `size`, a
`workArea` and a positive `scaleFactor`; anything else rejects `E_INVALID_ARGUMENT`. While displays are simulated,
window geometry (`@legendapp/spark/windows`: `getDisplays`, `getCursorPoint`, window bounds, `position`,
`setWindowBounds` and `centerWindow`) uses them as well, placing windows by each display's `origin` and work
area, so special windows such as presenter mode can be tested on two displays. Driven windows are never on screen.

## Platforms

| Platform | Availability |
| --- | --- |
| macOS | Available. |
| Windows | `getDisplayAvailability()` reports `unsupported-platform`; `getDisplayDetails` and `addDisplayListener` reject `E_UNSUPPORTED_PLATFORM`. Tracked in #318. `getDisplays()` in `@legendapp/spark/windows` works. |

The Kitchen Sink's Displays screen (`spark-ks://displays-graphics/displays`) shows every field and
logs change events; its flows are in `e2e/flows/displays-graphics/`.
