# Pointer

`@legendapp/spark/pointer` adds what React Native's views do not give a desktop app: custom
cursors, hiding the cursor until the pointer moves, trackpad gestures, Force Touch pressure,
the back and forward mouse buttons, and haptic feedback. macOS only; Windows is tracked in
[#331](https://github.com/LegendApp/legend-spark/issues/331).

```tsx
import { PointerView, getPointerAvailability, hideCursorUntilMoved, performHapticFeedback } from "@legendapp/spark/pointer";

<PointerView
  style={{ flex: 1 }}
  customCursor={{ type: "symbol", name: "pencil.tip" }}
  onMagnify={({ magnification }) => setScale(scale => scale + magnification)}
  onRotate={({ rotation }) => setAngle(angle => angle + rotation)}
  onSwipe={({ direction }) => direction === "left" ? next() : direction === "right" ? previous() : undefined}
  onSmartMagnify={() => setScale(scale => (scale === 1 ? 2 : 1))}
  onPressure={({ stage }) => stage === 2 && showPreview()}
  onMouseButton={({ button }) => (button === "back" ? goBack() : goForward())}
>
  <Canvas />
</PointerView>;
```

## Cursors

Standard cursors are React Native's `cursor` style (`style={{ cursor: "pointer" }}`), which
React Native macOS maps to AppKit's cursors (all CSS cursor names; core React Native's
TypeScript types list only `auto` and `pointer`). This module does not duplicate it.

A `PointerView`'s `customCursor` covers the view, except descendants with their own cursor:

| `customCursor` | Image | Hot spot |
|---|---|---|
| `{ type: "symbol", name, pointSize?, hotSpot? }` | An SF Symbol at `pointSize` (16) | Its center unless given |
| `{ type: "image", path, hotSpot }` | An image file (absolute path), at its size in points | Required |

A hot spot is in points from the image's top-left and must lie in the image: from 0 up to, not including, its width and height. A cursor that
cannot be loaded (an unknown symbol, an unreadable file) reports `E_INVALID_ARGUMENT` to
`onError` and the view shows no custom cursor. Setting both `customCursor` and the `cursor`
style throws `E_INVALID_ARGUMENT`; so do invalid values, and unknown keys throw
`E_UNSUPPORTED_OPTION`.

`hideCursorUntilMoved()` hides the cursor until the pointer moves. React Native text inputs
already do this on every typed key (AppKit's text views do), so call it for your own typing
surfaces, such as a canvas that takes keystrokes. It resolves once AppKit has hidden it.

## Gestures, pressure and mouse buttons

A `PointerView` reports the events it has a handler for, from itself and its descendants
(they travel AppKit's responder chain). Events without a handler pass on to the views
behind it, such as an enclosing scroll view. Locations `x` and `y` are points from the
`PointerView`'s top-left.

| Handler | Event | AppKit |
|---|---|---|
| `onMagnify` | `magnification` (the change to add to the current scale), `phase` | `magnifyWithEvent:` (pinch) |
| `onRotate` | `rotation` (degrees, clockwise as React Native's `rotate` transform), `phase` | `rotateWithEvent:` (AppKit's rotation is counterclockwise) |
| `onSwipe` | `direction`: `left`, `right`, `up`, `down` | `swipeWithEvent:`: three-finger swipes, when the trackpad is set to swipe between pages with three fingers |
| `onSmartMagnify` | location only | `smartMagnifyWithEvent:` (two-finger double tap) |
| `onPressure` | `pressure` (0-1), `stage` (1 click, 2 force click, 0 released), `stageTransition` | `pressureChangeWithEvent:` (Force Touch trackpad) |
| `onMouseButton` | `button`: `back` or `forward` | Mouse buttons 3 and 4, reported on release |

`phase` is NSEvent's: `began`, `changed`, `ended` and `cancelled` for a trackpad gesture, also
`stationary`, `mayBegin` and `none`. Two-finger swipes between pages are scroll events, not
`onSwipe`. The middle button is React Native's `onAuxClick`.

## Haptic feedback

`performHapticFeedback(pattern, { performanceTime? })` plays `generic`, `alignment` or
`levelChange` feedback on a Force Touch trackpad, `default` (soon), `now` or `drawCompleted`
(after the next screen update). It resolves once AppKit has the request. Without a Force
Touch trackpad (a mouse, an external trackpad without Force Touch) nothing plays and it
still resolves: AppKit offers no way to tell whether one is present.

## Availability

`getPointerAvailability(feature?)` is synchronous: `customCursors`, `hideCursorUntilMoved`,
`gestures`, `pressure`, `mouseButtons` or `haptics`, or every feature without one. It reports
the API path, not the hardware: gestures, pressure and haptics need a trackpad (Force Touch
for the last two) that macOS cannot detect. On other platforms every feature reports
`unsupported-platform`; `hideCursorUntilMoved` and `performHapticFeedback` reject and
`PointerView` throws `E_UNSUPPORTED_PLATFORM`. A missing native view or module reports
`missing-module` and fails with `E_MODULE_UNAVAILABLE`.

## Testing

The test driver delivers back and forward clicks, gestures and pressure as AppKit's own
NSEvents in the app, and reports the cursor AppKit would show without changing the real
one. In driver mode, cursor hiding is recorded, never applied
([test-driver.md](test-driver.md#cursor)). Flows use `mouseButton`, `pinch`, `rotate`, `swipe`
with three fingers, `smartZoomOn`, `forceClickOn` and `assertCursor`
([e2e-flows.md](e2e-flows.md#the-driver-backend)). Haptics are checked through their call path:
`tests/pointer.native.mm` records what reaches AppKit's performer, and the Kitchen Sink
reports that each call resolved. No test asserts that the trackpad played feedback.
