# Motion

`@legendapp/spark/motion` animates views on the platform compositor. JavaScript
describes an animation once; native code solves it, hands the result to the
compositor and reports completion. A blocked JavaScript thread does not stall a
running animation, a scroll-linked effect, or completion bookkeeping.

```tsx
import { MotionView, animate, spring, timing, decay, type MotionTarget } from '@legendapp/spark/motion';

const card = useRef<MotionTarget>(null);
<MotionView ref={card} initial={{ opacity: 0, translateY: 12 }} style={styles.card}>…</MotionView>

animate(card.current, { opacity: timing(1, { durationMs: 180 }), translateY: spring(0, { preset: 'snappy' }) });
// Gesture release: hand the pointer velocity (points per second) to the spring.
animate(card.current, { translateX: spring(0, { velocity: releaseVelocityX }) });
// Fling with a decay clamped to a range; a spring settles on the crossed bound.
const { finished } = animate(card.current, { translateY: decay({ velocity: vy, clamp: [-200, 0] }) });
```

## Platform support

| | macOS 14+ | Windows | iOS / Android / Web |
| --- | --- | --- | --- |
| Engine | Core Animation, played by the window server | Typed unsupported (see [Windows](#windows)) | Unsupported |

`getMotionAvailability()` is synchronous and truthful: `{ available: true }` only on
macOS when the `NativeSparkMotion` module and the `SparkMotionView` component are both
linked; otherwise `{ available: false, reason: 'unsupported-platform' | 'missing-module' }`.
Where motion is unavailable, every operation throws or rejects with `SparkError`
(`E_UNSUPPORTED_PLATFORM` or `E_MODULE_UNAVAILABLE`) and `MotionView` throws that error
when rendered. There is no JavaScript-driven fallback.

## API

| Export | Kind | Result |
| --- | --- | --- |
| `spring`, `timing`, `keyframes`, `decay`, `sequence` | Spec builders (pure) | Frozen, normalized `MotionSpec` |
| `animate(target, values, { delayMs, reducedValues, ...plan })` | Starts one plan | `MotionAnimation` |
| `stagger(targets, values, { eachMs, from, delayMs, reducedValues, ...plan })` | Starts one plan | `MotionAnimation` |
| `timeline(steps, plan)` | Starts one plan | `MotionAnimation` |
| `setMotionValues(target, values)` | Sets values, interrupting their animations | `Promise<void>` |
| `stopMotion(target, properties?)` | Freezes properties at their presented values | `Promise<void>` |
| `getMotionState(target)` | Presented values, velocities, animating properties | `Promise<MotionState>` |
| `linkScroll(target, options)` | Native scroll link | `Promise<AsyncRegistration>` |
| `recordMotionFrames(target, { durationMs })` | Frame telemetry | `Promise<MotionFrameReport>` |
| `getMotionEnvironment(target?)` | Reduce Motion, Reduce Transparency, Low Power Mode, frame rate, window visibility | `Promise<MotionEnvironment>` |
| `getMotionAvailability()` | | `Availability` |
| `motionPath(d, options)` | Path keyframes (pure) | `{ translateX, translateY, rotate? }` keyframes |
| `MotionView` | Component: `initial`, `enter`, `exit`, `layout`, `sharedId`, `transition` | |
| `MotionPresence` | Component: keeps removed children mounted while they exit | |
| `MotionNumber` | Component: a formatted number whose changed digits roll | |
| `MotionText` | Component: per-character crossfade or typewriter | |
| `MotionSymbol` | Component: an SF Symbol that plays symbol effects | |
| `playSymbolEffect(target, effect, options)` | Plays an SF Symbol effect | `Promise<SymbolEffectPlayback>` |
| `stopSymbolEffects(target)` | Removes a symbol's effects | `Promise<void>` |
| `getSymbolEffectAvailability(effect)` | | `Availability` |
| `MotionMaterial` | Component: a MotionView showing a backdrop material that crossfades and fades | |
| `getMaterialAvailability(material)` | | `Availability` |
| `MotionShape` | Component: a MotionView drawing a shape that morphs between paths and draws its stroke | |

A target is a mounted `MotionView`, as received through its `ref`. `animate`,
`stagger` and `timeline` validate synchronously and throw `SparkError`
(`E_INVALID_ARGUMENT`, `E_UNSUPPORTED_OPTION`, `E_NOT_FOUND` for an unmounted ref, or
the unavailability codes). The returned `MotionAnimation` has `finished`, which resolves
`{ finished: true }` when every animated property settles and `{ finished: false }`
when the animation is interrupted, stopped or its view unmounts. It rejects with the
`SparkError` the engine raised for rules only the solver can check: a spring that does
not settle within 60 s, infinite loops whose shared cycle exceeds 20 s
(`E_UNSUPPORTED_OPTION`), or a property driven by a scroll link (`E_BUSY`).
`stop()` freezes the animation's properties where they are.

`plan` is `MotionPlanOptions`: `reducedMotion` ([Reduce Motion](#reduce-motion)), `whenHidden`
([Hidden windows](#hidden-windows)) and `cues` ([Cues](#cues)). Unknown option names are
`E_INVALID_ARGUMENT`.

The API is imperative and works from any code holding a `MotionView` (or `MotionSymbol`) ref.
`MotionView`, `MotionPresence`, `MotionNumber`, `MotionText`, `MotionSymbol`, `MotionMaterial` and `MotionShape` are
the only React-specific exports (components). There are no hooks.

## Layout, presence and shared elements

```tsx
<MotionPresence>
  {rows.map(row => <MotionView key={row.id} layout="position" initial={{ opacity: 0 }}
    enter={{ opacity: timing(1, { durationMs: 200 }) }} exit={{ opacity: timing(0, { durationMs: 200 }) }}>…</MotionView>)}
</MotionPresence>
{open ? <MotionView sharedId="photo" style={styles.detail} /> : <MotionView sharedId="photo" style={styles.thumbnail} />}
```

* **Layout** (`layout="position"` or `"frame"`). When a mounting transaction moves the view (a
  sibling was added, removed, resized or reordered, or its own size changed), the native view
  compares its layout box before and after the transaction and hands the difference to the
  engine: the view keeps showing where it was, then animates to its new place with
  `transition`. `position` keeps the leading top corner moving (top-right in right-to-left
  layouts) and applies a size change at once; `frame` keeps the centre and scales from the old
  size, so the content scales during the transition. Boxes are compared in the nearest ancestor
  `MotionView` that animates its own layout (it carries this view), otherwise in the window. No
  JavaScript runs for it. Live window resizing does not animate (the view would trail the window
  edge).
* **Hand-off.** Layout drives `translateX` and `translateY` (and `scaleX`, `scaleY` for `frame`):
  each starts at the value that keeps the view in place, with its current velocity, and animates
  to the value it was heading for (the end of its running animation, or its value at rest). A
  layout change during a layout animation continues from where the view shows. It replaces an
  `animate()` running on those properties, which then reports `{ finished: false }`, but keeps
  that animation's target. Properties driven by a scroll link or repeating forever are left alone.
* **Presence.** `enter` animates when the view mounts (from `initial`). `exit` needs a
  `MotionPresence` ancestor: when a child of the presence (matched by key) is removed, the
  presence keeps rendering it in its place, its `MotionView`s play `exit`, and it unmounts once
  they all settle; a child without `exit` unmounts at once. Siblings with `layout` then reflow
  smoothly. A child added back while it exits stays and plays `enter`, which interrupts `exit`.
  A `MotionView` with `exit` outside a presence, or with an `exit` that repeats forever (it would never
  unmount), throws `E_INVALID_ARGUMENT`.
* **Shared elements** (`sharedId`). A `MotionView` that mounts with an id animates from the box
  (position, size and velocity, including its running motion) where another `MotionView` with the
  same id showed when the mounting transaction began, in the same window: translation from the
  centre difference, scale from the size ratio. The source must be mounted when the destination
  mounts (React commits both changes together, or the source is still exiting in a
  `MotionPresence`). Both stay visible if both stay mounted. Cross-window transitions are #179.
* **Transition.** `transition` is `{ type?: 'spring', …spring parameters }` (the default is the
  `smooth` preset) or `{ type: 'timing', durationMs, easing }`; animation options such as
  `velocity`, `delayMs` or `repeat` are `E_UNSUPPORTED_OPTION`, and `transition` without `layout`
  or `sharedId` is `E_INVALID_ARGUMENT`.
* The engine's telemetry records these hand-offs like any animation, so `assertMotion`,
  `captureMotion` and frame captures work on them ([Motion telemetry](#motion-telemetry)).
* Reduce Motion is not applied yet; motion accessibility is #177.

## Architecture

```
JS: validate and normalize  ── one JSON plan ──▶  RNSparkMotion (TurboModule, main queue)
                                                   SparkMotionCoordinator (macOS glue)
                                                     spark::motion::Engine (portable C++):
                                                     curves, interruption, timelines,
                                                     clock, completion, baking
                                                   ── CAKeyframeAnimation ──▶ window server
```

* **Portable solver** (`packages/motion/cpp`). Springs, timing curves, keyframes,
  decay, sequences, repeats, interruption state, timeline resolution, completion
  sweeps and sample baking are plain C++ with no platform types. It validates every
  request again, so malformed transport input fails as `E_INVALID_ARGUMENT` and never
  crashes: the macOS glue reads JSON through typed readers and turns every C++
  exception into a rejection. `tests/motion-engine.native.cpp` tests it directly.
* **Compositor ownership.** Each start, interruption or completion bakes the affected
  channel once into `CAKeyframeAnimation`s on the `MotionView`'s own layer
  (`transform`, `opacity` and the [visual effects](#visual-effects)' key paths) at the display's frame rate (at most 120 samples per second;
  [Frame rate and power](#frame-rate-and-power)), linearly interpolated. The
  window server plays them, so neither the JavaScript thread nor the app's main thread
  produces frames. Completion uses one one-shot timer for the next settle time; nothing
  polls.
* **Why bake instead of `CASpringAnimation`.** One solver must answer "where is
  this property and how fast is it moving right now" for every animation kind,
  so interruption and gesture hand-off are exact. `CASpringAnimation` cannot be
  composed with decay bounds, sequences or arbitrary interruption.
* **One layer, composed transform.** AppKit pins layer anchors at `{0,0}` and resets
  `layer.transform` during display. Spark keeps the model transform through React
  Native macOS's `transform3D` and bakes one composed matrix per sample:
  `translate · rotate · scale` about the view's centre. Opacity is a separate channel.
* **Model and presentation.** The model value is set to the animation's final value
  and the compositor animation covers the path, so a removed animation never jumps
  back. `MotionView` rejects `style.transform` and `style.opacity` (motion owns them;
  use `initial`). `initial` applies once, at mount.

## Properties and units

`opacity`, `translateX`, `translateY` (points), `scale`, `scaleX`, `scaleY`,
`rotate` (degrees, clockwise), and the [visual effects](#visual-effects): `rotateX`, `rotateY`
(degrees), `perspective` (points), `backgroundColor` (a color), `borderRadius`, `shadowOpacity`,
`shadowRadius`, `shadowOffsetX`, `shadowOffsetY`, `blur` (points), the mask's `maskInsetTop`,
`maskInsetBottom`, `maskInsetStart`, `maskInsetEnd` and `maskRadius` (points), and a
[`MotionMaterial`](#backdrop-materials)'s `materialIntensity` and `materialTintOpacity` (0-1), and a
[`MotionShape`](#shapes)'s `morph`, `strokeStart`, `strokeEnd` (0-1), `strokeWidth` (points), `fillColor` and
`strokeColor` (colors). `scale` drives both
axes and cannot be combined with `scaleX`/`scaleY`. Velocities are units per second (multiply React Native
gesture velocities, which are per millisecond, by 1000). Durations and delays are
milliseconds. A bare number in `animate()` means `spring(value)` with the platform
default preset.

## Springs

`spring(to, options)` accepts exactly one parameterization; mixing them is
`E_INVALID_ARGUMENT`:

* physical: `mass` (default 1), `stiffness`, `damping`;
* perceptual: `responseMs` and `bounce` (−1 < bounce < 1). `bounce = 0` is critically
  damped; positive values overshoot; negative values are overdamped. Converted as in
  SwiftUI: `stiffness = (2π / response)² · mass`, damping ratio `1 − bounce` (≥ 0) or
  `1 / (1 + bounce)` (< 0), `damping = 4π · ratio · mass / response`;
* `preset` (the default is `default`). The macOS presets are SwiftUI's:

| Preset | macOS | SwiftUI equivalent |
| --- | --- | --- |
| `default` | 550 ms, bounce 0.175 | `.spring` |
| `smooth` | 500 ms, bounce 0 | `.smooth` |
| `snappy` | 500 ms, bounce 0.15 | `.snappy` |
| `bouncy` | 500 ms, bounce 0.3 | `.bouncy` |
| `interactive` | 150 ms, bounce 0.14 | `.interactiveSpring` |

The returned spec contains the resolved `mass`, `stiffness` and `damping`. Windows
presets will be defined with the Windows implementation.

The solver uses the closed-form damped-oscillator solution (under-, critically and
over-damped) for value and velocity. A spring or decay settles when displacement and
speed are both below `restDelta` and `restSpeed`. The defaults are per property:
0.01 pt (or degree) and 0.1 per second for translation and rotation, 0.0005 and
0.005 per second for opacity and scale, so opacity never visibly snaps at the end.
The final value is then exact.

## Visual effects

```tsx
<MotionView ref={card} initial={{ backgroundColor: '#2563eb', borderRadius: 8, perspective: 500 }} style={styles.card} />

animate(card.current, { backgroundColor: timing('#facc15', { durationMs: 400 }) });   // in OKLCH
animate(card.current, { borderRadius: spring(20), shadowOpacity: spring(0.4), shadowRadius: spring(14), shadowOffsetY: spring(8) });
animate(card.current, { blur: timing(6), rotateY: spring(180, { preset: 'smooth' }) });
animate(card.current, { maskInsetEnd: timing(0, { durationMs: 600 }) });              // wipe in from the leading edge
animate(arrow.current, motionPath('M0 0 C40 -36 120 36 160 0', { durationMs: 900, rotate: true }));
```

Every effect is one or more engine properties, solved, interrupted, reduced and recorded like the
transform, and baked into Core Animation keyframe animations on its own layer key path:

| Properties | Layer | Notes |
| --- | --- | --- |
| `rotateX`, `rotateY`, `perspective` | `transform` | Composed as `translate · perspective · rotateX · rotateY · rotate · scale` about the centre. `perspective` below 1 is none. |
| `backgroundColor` | `backgroundColor` | Four engine properties, its [OKLCH components](#colors). |
| `borderRadius` | `cornerRadius` | The uniform corner radius. |
| `shadowOpacity`, `shadowRadius`, `shadowOffsetX`, `shadowOffsetY` | `shadowOpacity`, `shadowRadius`, `shadowOffset` | The shadow color is the style's (`shadowColor`, black by default). |
| `blur` | `filters.sparkBlur.inputRadius` | A `CIGaussianBlur` layer filter, installed while the blur shows or animates and removed once it settles at 0 (with the view's Core Image filter support, when no other filter remains). |
| `maskInset*`, `maskRadius` | the mask layer's `bounds`, `position`, `cornerRadius` | A rounded-rectangle mask inset from the view's edges; start and end follow the layout direction. Installed while it masks or animates. |

**Who owns a property.** Motion always owns `opacity` and `transform`: `style` must not set them.
The background color, corner radius and shadow belong to the view's `style` until motion first
drives them, through `initial`, `animate`, `stagger`, `timeline`, `setMotionValues` or a scroll
link (`stopMotion` takes nothing). Until then the engine follows what the style puts on the layer,
so an animation starts from what the view shows and `getMotionState` reports it; afterwards motion
owns that channel (the background, the corners, or the whole shadow), and later style changes to
it are not applied. `initial` and `style` setting the same property is `E_INVALID_ARGUMENT`. Motion
owns the shadow's shape too: once it drives the corners or the shadow, the shadow follows the layer
instead of the path React Native builds from the style's radii.

**Style drawn on other layers.** React Native draws some styles on layers motion does not drive, so
animating them would do nothing; motion rejects them with `E_UNSUPPORTED_OPTION` instead:

* `backgroundColor` and `borderRadius` when React Native draws the border itself and the background
  on a sublayer: a visible border without `overflow: 'hidden'`, per-side border colors, widths or
  styles, a non-solid `borderStyle`, or per-corner radii. Put the border on a child, or clip with
  `overflow: 'hidden'`.
* The mask properties when the style clips with a mask: `overflow: 'hidden'` with per-corner radii.

The native view decides this from the style React Native resolved, for `animate`, `stagger`,
`timeline`, `setMotionValues` and scroll links (the whole plan is rejected before anything
changes). `MotionView` rejects an `initial` that sets them when it renders, by the same rules read
from `style` (conservatively: a per-side or per-corner key counts even if all sides are equal). A
style that changes into one of these after motion took the property is not detected.

**Captures.** Driver captures render in-process, which shows colors, corners, masks and 2D
transforms, but not shadows, layer filters (blur) or 3D perspective; flows check those through the
values the engine reports.

**Reduce Motion.** The `fade` alternate changes the 3D rotation, perspective and mask edges at once
(they travel) and fades colors, corners, shadows and blur over 200 ms without overshoot.

### Colors

`backgroundColor` (and a [shape](#shapes)'s `fillColor` and `strokeColor`) takes `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` (comma or space
syntax, percentages), `oklch(L C H / A)` (chroma 100% is 0.4) or `transparent`; anything else (named
colors, platform colors, `color()`) is `E_INVALID_ARGUMENT`. JavaScript converts a color once to
OKLCH and sends lightness, chroma, hue and alpha as four engine properties
(`backgroundColorL`, `backgroundColorC`, `backgroundColorH`, `backgroundColorAlpha`) with the
spec's timing; the native engine converts every sample back to extended sRGB, so colors outside
sRGB survive on wide-gamut displays. Interpolating in OKLCH keeps lightness and saturation even:
halfway from blue to yellow is a saturated green, where an sRGB blend is gray.

* The hue takes the shorter way round, from where it is; keyframes and sequences unwrap each stop
  from the previous one.
* A component that does not show does not travel: the hue of a gray starts at the target's hue,
  and lightness, chroma and hue of a transparent color start at the target's, so only alpha fades.
  A gray stop takes the hue of the nearest colored stop, a transparent stop the color of the
  nearest visible one.
* `spring`, `timing`, `keyframes` and `sequence` take colors (all stops of one spec are colors);
  `decay` cannot. `velocity`, `restDelta` and `restSpeed` are `E_UNSUPPORTED_OPTION` on a color
  animation: each component has its own. Scroll links take colors as `output` stops.
* `getMotionState` reports `colors.backgroundColor`, `colors.fillColor` and `colors.strokeColor` as CSS
  `oklch(L C H / A)`; `values` carries the four components of each (`fillColorL`, …). `stopMotion(target,
  ['backgroundColor'])` stops all four.

### Path animation

`motionPath(d, { durationMs, easing = 'easeInOut', rotate, delayMs, repeat, reverse })` turns an
SVG path ([path data](#path-data)) into `translateX`
and `translateY` keyframes, in points from where the view rests (start the path at `M0 0`), and
with `rotate: true` a `rotate` track that turns the view to the path's heading (degrees, 0 along
+x, unwrapped). Keyframes sit at even distances along the flattened path (at most 240), and land
when the easing has covered that share of the length, so the view moves along the path at the
easing's pace. Spread the result into `animate`; the engine plays it like any keyframes. Arcs
(`A`) and easings whose control points leave [0, 1] are `E_UNSUPPORTED_OPTION`. The path is not
mirrored in right-to-left layouts.

### Path data

`motionPath` and `MotionShape` read SVG path data: `M`, `L`, `H`, `V`, `C`, `S`, `Q`, `T` and `Z`, absolute (upper case)
and relative (lower case). Numbers use SVG's syntax: an optional sign, digits with an optional fraction and an exponent
in either case (`-1.5E2`, `+.5`; `1-2` and `.5.5` are two numbers each). Tokens are separated by whitespace, and two
numbers also by at most one comma. Lines and quadratic curves become the cubic Bézier curves that draw them exactly; `S`
reflects the previous `C` or `S` control point and `T` the previous `Q` or `T` one, otherwise their first control point
is the current point. `Z` right after `Z` does nothing. Parsing is strict, and each error names the character it is at:

* any other character, a comma before a command or not between two numbers, and data that does not start with `M` are
  `E_INVALID_ARGUMENT`;
* so is a command missing a number (the error names the command, and the token or end of data where a number belongs),
  and a number after `Z`, which takes none;
* arcs (`A`) are `E_UNSUPPORTED_OPTION`; draw them with cubic curves.

Before #406, `motionPath` read path data more loosely: it skipped characters it did not recognize (commas anywhere
included), rejected an upper-case exponent (`1E2`) as an unknown command, and let `S` and `T` reflect the previous
curve's control point whichever kind it was. Those inputs now fail or follow the rules above; other paths give the
same keyframes as before, up to floating-point rounding.

## Shapes

```tsx
const STAR = 'M60 12 L72 45 L108 46 L80 68 L89 102 L60 83 L31 102 L40 68 L12 46 L48 45 Z';
const CIRCLE = 'M60 12 C86.5 12 108 33.5 108 60 C108 86.5 86.5 108 60 108 C33.5 108 12 86.5 12 60 C12 33.5 33.5 12 60 12 Z';
<MotionShape ref={shape} paths={[CIRCLE, STAR]} initial={{ fillColor: '#2563eb' }} style={{ width: 120, height: 120 }} />
<MotionShape ref={check} paths={['M16 38 L30 52 L58 22']} lineCap="round" lineJoin="round"
  initial={{ strokeColor: '#16a34a', strokeWidth: 7, strokeEnd: 0 }} style={{ width: 72, height: 72 }} />

animate(shape.current, { morph: spring(1, { preset: 'bouncy' }), fillColor: timing('#f59e0b') });  // circle to star
animate(check.current, { strokeEnd: timing(1, { durationMs: 600 }) });                             // draw the checkmark
```

`MotionShape` is a `MotionView` (every `MotionView` prop, `ref` and operation applies) whose content is a
`CAShapeLayer`, drawn over the view's own background, with no children (`E_INVALID_ARGUMENT`). Its props are
`paths` (1 to 16 strings of [path data](#path-data), in points from the view's top-left corner, y down; not mirrored in
right-to-left layouts), `lineCap` (`butt`, `round`, `square`), `lineJoin` (`miter`, `round`, `bevel`) and `fillRule`
(`nonzero`, `evenodd`). Everything that animates is a motion property: springs, timing, keyframes, interruption with
velocity, telemetry, scroll links and captures work on them, baked into Core Animation keyframe animations on the shape
layer.

| Property | Default | Layer |
| --- | --- | --- |
| `morph` | 0 | `path`: `k` shows `paths[k]`; `k + f` is `f` of the way from `paths[k]` to `paths[k + 1]` |
| `strokeStart`, `strokeEnd` | 0, 1 | `strokeStart`, `strokeEnd`: the drawn part of the stroke, as shares of its length |
| `strokeWidth` | 1 | `lineWidth`, in points |
| `fillColor`, `strokeColor` | transparent | `fillColor`, `strokeColor`, in [OKLCH](#colors) |

**Morphing.** A morph interpolates the points of two paths one to one. Paths therefore need the same subpaths (as many
`M`s, each closed with `Z` or open alike); otherwise the component throws `E_UNSUPPORTED_OPTION` naming the two paths.
Subpaths with different numbers of segments are subdivided: the longest segments of the shorter one are halved (at their
curve midpoint, which keeps the shape exact) until every path has as many segments as the longest. Points correspond in
drawing order from each subpath's `M`, so start the shapes at corresponding points and draw them in the same direction
(clockwise from the top, say); a star that starts at its left point morphs from a circle that starts at its top with a
twist. Beyond 0 and the last path, `morph` continues the nearest pair, so a spring's overshoot overshoots the shape.

**Limits and cost.** At most 16 paths of at most 10,000 characters and 128 cubic segments each after subdivision
(`E_INVALID_ARGUMENT` beyond). JavaScript parses and subdivides the paths when their contents or the stroke style
change (not on every render) and sends the points as one JSON prop; the native view keeps them in one flat array and
builds a path only for the model value (when `morph` changes) and for each baked sample of a running morph. Since each
sample of the morph is a whole path, the morph bakes at most 60 samples a second (the other shape properties bake at the
display's rate, [Frame rate and power](#frame-rate-and-power)) and at most 240 per part: one for the finite part and one
for a loop. A morph longer than 4 s (a long spring, a 20 s loop) is sampled more coarsely, linearly interpolated by the
compositor between samples. A sample path takes about 50 bytes per segment (three 16-byte points), so a morph holds at
most 482 paths: about 3.1 MB for a 128-segment shape, 60 KB for a 2-segment checkmark, until the bake is replaced or
ends. Nothing runs per frame.

A change of `paths` applies at once, at the current `morph`; a running morph continues on the new paths. With fewer
paths, a `morph` beyond the new last path is not clamped: it continues the last pair as an overshoot does, so set or
animate `morph` back into range with the change.

**Who owns the shape properties.** Only a `MotionShape` has them: in `initial`, `animate`, `stagger`, `timeline`,
`setMotionValues` or a scroll link on another `MotionView` they are `E_UNSUPPORTED_OPTION`.

**Reduce Motion.** Under the `fade` alternate, `morph`, `strokeStart` and `strokeEnd` travel: the shape changes and the
stroke is drawn at once, and the view fades in there over 200 ms (as a moved view does); `strokeWidth` and the colors fade
over 200 ms. A drawn progress indicator that should keep moving under Reduce Motion passes `reducedMotion: 'play'` or its
own `reducedValues`.

**Availability.** A `MotionShape` needs nothing beyond motion: where `getMotionAvailability()` is available it is, and
elsewhere it throws motion's typed error before reading its paths.

## Backdrop materials

```tsx
const panel = useRef<MotionTarget>(null);
<View style={styles.card}>
  <MotionMaterial ref={panel} material="hudWindow" tintColor="#2563eb40" initial={{ materialIntensity: 0 }} style={StyleSheet.absoluteFill} />
  <Text>…</Text>
</View>

animate(panel.current, { materialIntensity: timing(1, { durationMs: 300 }) });   // fade the material in
animate(panel.current, { materialTintOpacity: spring(0) });                         // and its tint out
setMaterial('popover');                                                              // a re-render crossfades to it
```

`MotionMaterial` is a `MotionView` (every `MotionView` prop, `ref` and operation applies) whose content is a
backdrop material: an `NSVisualEffectView`, or Liquid Glass (`NSGlassEffectView`). It has no children (they are
`E_INVALID_ARGUMENT`); put it behind content, usually with `StyleSheet.absoluteFill`, and round it with
`borderRadius` and `overflow: 'hidden'`. It is the animatable counterpart of two static surfaces: a window's
behind-window vibrancy (`macos.backgroundMaterial`, [windows](api-window-contract.md)) and `GlassView`
(`@legendapp/spark/ui/glass`), Liquid Glass that hosts its children.

| Prop | Values |
| --- | --- |
| `material` | `titlebar`, `selection`, `menu`, `popover`, `sidebar`, `headerView`, `sheet`, `windowBackground`, `hudWindow`, `fullScreenUI`, `toolTip`, `contentBackground`, `underWindowBackground`, `underPageBackground` (AppKit's `NSVisualEffectMaterial`), `glass` and `clearGlass` (Liquid Glass) |
| `blendingMode` | `behindWindow` (default: the desktop and windows behind the window) or `withinWindow` (the window's own content behind the view) |
| `state` | `followsWindowActiveState` (default), `active`, `inactive` |
| `emphasized` | The emphasized look of `selection` |
| `tintColor` | A [color](#colors) drawn over the material at `materialTintOpacity` |
| `crossfade` | How a change of material crossfades: a [`MotionTransition`](#layout-presence-and-shared-elements) (default: 250 ms, ease-in-out) |

Liquid Glass has no `blendingMode`, `state` or `emphasized` (`E_UNSUPPORTED_OPTION`), takes the view's corner radius: a
`borderRadius` animation reshapes the glass to its target radius at once, when the animation starts (the glass draws
its own shape, which Core Animation cannot animate), and needs macOS 26 and an app built with the macOS
26 SDK. `getMaterialAvailability(material)` asks the native side, so it is `{ available: true }` only when both have
the material (`host-restriction` otherwise; `unsupported-platform` or `missing-module` like motion); rendering an
unavailable material throws `E_UNAVAILABLE`.

**Why a crossfade.** Material, blending mode and state are not animatable layer properties, and driving the
window server's backdrop blur radius needs private Core Animation filters, which Spark does not use. So:

* `materialIntensity` (default 1) is the opacity of the material views, under the tint, which it does not fade: 0
  shows what is behind the view unblurred (with the tint over it), 1 the material. `materialTintOpacity` (default 1) is the opacity of `tintColor`. Both are engine
  properties: springs, timing, keyframes, interruption, telemetry, scroll links and captures work on them, baked into
  Core Animation keyframe animations on the material's and the tint's layers.
* A change of `material` (or `blendingMode`, `state`, `emphasized`) adds the new material over the one showing and
  the engine fades it in with `crossfade`; the old one is removed once it is covered. Overlapping crossfades keep at most three materials (the one showing, an
interrupted one and the incoming one): a fourth change drops the oldest, which lies under the partly faded ones. A change during a crossfade
  leaves the material it interrupted as far as it got and fades the newest in over it, so nothing jumps. The
  crossfade is the engine property `materialCrossfade` (0 to 1): telemetry reports it and `waitForMotion` waits for
  it, but only material changes drive it (`animate` and `setMotionValues` reject it with `E_INVALID_ARGUMENT`). A
  `tintColor` change applies at once.
* `materialIntensity` and `materialTintOpacity` on a `MotionView` that is not a `MotionMaterial` (in `initial`,
  `animate`, `stagger`, `timeline`, `setMotionValues` or a scroll link) are `E_UNSUPPORTED_OPTION`: it has no
  material to drive.

**Reduce Motion.** Intensity, tint and crossfade are fades: under the `fade` alternate they fade over 200 ms without
overshoot, and a crossfade under Reduce Motion is that 200 ms fade whatever its `crossfade` transition.

**Reduce Transparency.** AppKit draws every material opaque while the user's Reduce Transparency setting is on, and
motion leaves that to it: a crossfade then fades between two opaque fills (the old one stays opaque until the new one
covers it). `materialIntensity` below 1 is the app's explicit choice to show what is behind the view, and applies as
set. `getMotionEnvironment()` reports `reduceTransparency` for apps that choose different content, such as an opaque
panel instead of a faded-in material.

**Captures.** Driver captures render in-process, where the window server's backdrop blur does not exist: every
material draws as the same flat fill, whatever its blending mode. Kitchen Sink goldens use `withinWindow` materials and
are captured at rest (the material faded out, and tinted); flows check materials, intensity, tint and crossfades
through the values the engine reports.

## Text transitions

```tsx
<MotionNumber value={count} locale="en" style={{ fontSize: 28 }} />
<MotionText text={status} />
<MotionText text={reply} transition={{ type: 'typewriter', characterMs: 30 }} />
```

* `MotionNumber` (`value`, `locale`, `format`: `Intl.NumberFormat` options, `style`, `transition`)
  shows a formatted number. Each digit is a column of the locale's ten digits in its own
  `MotionView`; a changed digit rolls its column to the new digit with `transition` (default: the
  `snappy` spring). Digits are matched from the right, so 999 → 1,000 rolls the last three and
  adds the leading one. The number reads as one accessibility element; it lays out left to right
  at the leading edge.
* `MotionText` (`text`, `style`, `transition`) shows text a character at a time, each in its own
  `MotionView`. `{ type: 'crossfade', durationMs = 200 }`: a changed character fades in while the
  old one fades out where the new one stands, characters past a shorter text fade out in place,
  and new ones fade in. `{ type: 'typewriter', characterMs = 40 }`: characters the text keeps from
  the previous text stay, and the rest fade in one after another, `characterMs` apart and each over
  `characterMs`; the first text is typed too.
  A character is what a reader sees (a base with its combining marks, an emoji sequence, a flag);
  scripts whose letters join or form conjuncts (Arabic, Syriac, N'Ko, Mongolian, Indic, Southeast
  Asian, Tibetan) animate a word at a time so they keep their shapes. Characters lay out in a
  wrapping row in the layout direction; bidirectional text is not reordered. With a proportional
  font the old glyph of a crossfading character fades at the new one's place, so the crossfade
  suits tabular digits and monospaced labels.
* With a `testID`, each digit's `MotionView` is `<testID>-digit-<n>` (`n` from 1 at the units digit)
  and each character's `<testID>-char-<index>`, so flows can read their motion telemetry.
* Both run on the engine like any animation: interruptible, recorded, and under Reduce Motion a
  roll jumps and fades in (the `fade` alternate) and fades play as written.

## Symbol effects

```tsx
const bell = useRef<MotionSymbolTarget>(null);
<MotionSymbol ref={bell} name={muted ? 'bell.slash.fill' : 'bell.fill'} size={32} color="#f59e0b" replaceTransition="downUp" />

const { played, remove } = await playSymbolEffect(bell.current, 'bounce', { direction: 'up', repeat: Infinity });
await remove();
```

`MotionSymbol` (`name`, `size` in points, default 24, `color`, `replaceTransition`) shows an SF
Symbol in an `NSImageView`; a name this macOS does not have is `E_NOT_FOUND`. A change of `name`
animates with `replaceTransition` (`replace`, `downUp`, `upUp`, `offUp`; AppKit's
`NSSymbolReplaceContentTransition`), or at once without one.

`playSymbolEffect(target, effect, { repeat = 0, speed = 1, byLayer, direction, reducedMotion })`
adds AppKit's `NSSymbolEffect` to the image view: `bounce` (`up`, `down`), `pulse`, `wiggle` (`up`,
`down`, `left`, `right`, `forward`, `backward`, `clockwise`, `counterClockwise`; forward and
backward follow the layout direction), `rotate` (`clockwise`, `counterClockwise`), `breathe`,
`drawOn`, `drawOff`. `repeat` is extra plays (`Infinity` until removed); drawing on or off plays once
(`E_UNSUPPORTED_OPTION` with `repeat`). It resolves `{ played, remove() }`, where `played` is what
played and `remove()` removes an effect that keeps playing. `stopSymbolEffects(target)` removes all
of them.

| Effect | Needs |
| --- | --- |
| `bounce`, `pulse`, `replace` transitions | macOS 14 |
| `wiggle`, `rotate`, `breathe` | macOS 15, and an app built with the macOS 15 SDK |
| `drawOn`, `drawOff` | macOS 26, and an app built with the macOS 26 SDK |

`getSymbolEffectAvailability(effect)` asks the native side, so it is `{ available: true }` only when
both the app's SDK and the running macOS have the effect (`host-restriction` otherwise;
`unsupported-platform` or `missing-module` like motion). An unavailable effect rejects with
`E_UNAVAILABLE`. Under Reduce Motion (read when the effect starts), nothing travels: the `fade`
alternate (default) plays `pulse` instead and fades drawing on or off over 200 ms, `instant` plays
nothing and shows or hides a drawn symbol at once (`played: 'none'`), and `play` plays as written; a
name change cross-fades instead of its transition. Symbol effects run on AppKit's clock, not the
engine's: the virtual clock does not hold them, and captures show the symbol at rest.

## Interruption and velocity

Every animation is interruptible at any time by `animate`, `setMotionValues`,
`stopMotion`, a later plan or `stop()`. The engine evaluates the running curve
analytically at the interruption instant and starts the replacement from that value
**and velocity**:

* `spring` and `decay` continue the inherited velocity.
* `timing` (and a keyframes animation's first segment) starts at exactly the
  inherited velocity. The eased curve gets an additive term `extra · t · (1 − t/D)²`,
  where `extra` is the inherited velocity minus the easing's own initial velocity.
  It is exact at `t = 0` and vanishes with zero slope at `t = D`, so the easing's end
  and the duration are unchanged. A fast hand-off therefore overshoots (or dips) by at
  most `4 · D · |extra| / 27` instead of losing velocity. An earlier draft clamped the
  Bézier slope to ±8, which turned an 11,537 pt/s hand-off into 133 pt/s; that clamp
  is gone (`tests/motion-engine.native.cpp` checks 11,537 pt/s for four easings).
  A property at rest (speed at or below `restSpeed`) plays the easing unchanged.
* An explicit `velocity` option overrides inheritance. This is the gesture hand-off:
  track a drag with `setMotionValues()`, then on release
  `animate(target, { translateX: spring(0, { velocity: vx }) })`.
* During a `delayMs`, the interrupted animation keeps moving; the replacement starts
  from its state when the delay ends.

## Timing, keyframes, sequences, staggers, repeat, reverse

* `timing(to, { durationMs = 250, easing = 'easeInOut' })`: `linear`, `easeIn`,
  `easeOut`, `easeInOut`, `standard`, or a cubic Bézier `[x1, y1, x2, y2]` with x in
  [0, 1].
* `keyframes(values, { durationMs, offsets, easing })`: starts at the current value
  and passes through `values` at `offsets` (strictly increasing in (0, 1], ending at 1;
  default even). `easing` is one easing or one per segment.
* `sequence(steps, options)`: a per-property chain; each step starts from the previous
  step's end value and velocity. A step cannot repeat forever.
* `repeat: n` (extra plays, `Infinity` allowed) and `reverse: true` (alternate
  direction) on any spring, timing, keyframes or sequence. Decay, and sequences that
  contain one, cannot repeat or reverse: decay depends on its start velocity.
* `delayMs` on any animation, and on the whole `animate()` call.
* `stagger(targets, values, { eachMs, from })` offsets each target by `eachMs` from the
  first, last or center target. `timeline(steps)` starts each step relative to the
  timeline start (`after: 'start'`, the default) or after the previous step's natively
  solved end (`after: 'previous'`), plus `offsetMs`. Both send one plan, so start times
  are resolved natively. A plan drives each property of a view once; steps after an
  infinitely repeating step are rejected.

Infinitely repeating channels are baked as one finite lead-in plus a looping period:
the least common multiple of the view channel's infinite cycles, rounded to whole
milliseconds. A shared cycle over 20 s is rejected with `E_UNSUPPORTED_OPTION`.

## Decay

`decay({ velocity, deceleration = 0.998, clamp, clampSpring })`: exponential
deceleration (`deceleration` is retained per millisecond, React Native's convention);
the velocity defaults to the inherited one. With `clamp: [min, max]` the motion
switches, at the exact crossing time, to a spring towards the bound carrying the
crossing velocity (`clampSpring`, default `{ responseMs: 300, bounce: 0 }`). A start
outside the range springs to the nearer bound.

## Scroll-linked and progress-driven motion

`linkScroll(target, { source: { nativeID }, axis = 'y', input, output, extrapolate = 'clamp' })`
maps a scroll view's offset through piecewise-linear `input → output` ranges onto
motion properties. `input` needs at least two strictly increasing stops, and each
output exactly one value per stop. The native glue observes the `NSClipView` bounds of
the React Native ScrollView whose `nativeID` matches, in the target's window, on the
main thread; no JavaScript runs per scroll event. Linked properties belong to the
link: `animate` and `setMotionValues` on them fail with `E_BUSY` until the returned
registration's `remove()`. Unmounting the target removes its links.

## Frame evidence

`recordMotionFrames(target, { durationMs })` (at most 10 s, real clock only) samples the
target's presentation layer on its display link and reports `frames`,
`animatedFrames`, `droppedFrames` (missed display-link intervals), `stalledFrames`
(animated frames whose presented value did not change), `maxFrameGapMs`,
`refreshRate` and `durationMs`. A window that is not on screen (the test driver never shows
windows) has no display link of its own, so its views are sampled on the main screen's. It shows that the main thread kept its display-link
cadence and that the compositor animation advanced on every frame. It is not a
measurement of the window server's own frame delivery, which needs out-of-process
instrumentation.

The Kitchen Sink screen `spark-ks://motion-system/scroll-and-frames` blocks the
JavaScript thread for 500 ms during a 1.5 s animation and shows the report.

## Reduce Motion

Every animation has a designed Reduce Motion alternate. When a plan starts while the user's
Reduce Motion setting (`NSWorkspace.accessibilityDisplayShouldReduceMotion`) is on, each step
plays its own `reducedValues` if it has them (`animate`'s and `stagger`'s `reducedValues`, or a
timeline step's), else the plan's `reducedMotion` alternate:

| `reducedMotion` | A step without `reducedValues` |
| --- | --- |
| `fade` (default) | Nothing travels. Transforms change at once; opacity animates to its target in a 200 ms ease-in-out fade with no overshoot. A step that moves a view without driving its opacity fades it in from 0 where it lands; a step that fades a view out keeps it in place until it is gone. An infinitely repeating track holds where it is. |
| `instant` | Every value changes at once, after the step's own delay. |
| `play` | The plan as written: motion the user directly drives, such as a drag release. |

Timeline steps after `previous` start when the alternate of the previous step ends, so a
reduced timeline is as short as its alternates. The setting is read once per plan, when it
starts: a running animation is not changed when the user toggles it. Only the properties that play are taken
from the view's style ([Who owns a property](#visual-effects)): a step's own `reducedValues` replace its values. `getMotionEnvironment()`
reports the setting for code that chooses different content rather than different motion. The
engine marks changes made at once as kind `jump` in [motion telemetry](#motion-telemetry).
Layout and shared-element hand-offs follow the same rule with the `fade` alternate: under
Reduce Motion the view is at its new place at once and fades in there, and in a hidden window
the hand-off completes at once.

## Frame rate and power

Animations are baked at the frame rate of the display that shows the view's window
(`NSScreen.maximumFramesPerSecond`; the main display for a view without a window), capped at
120 Hz, and at 60 Hz in Low Power Mode (`NSProcessInfo.lowPowerModeEnabled`). Each Core Animation
animation asks the compositor for that rate (`preferredFrameRateRange` from half the rate to the
rate): a ProMotion display runs motion at 120 Hz only when asked, and a 60 Hz display or Low Power
Mode gets no more samples than it can show. Timing does not depend on the rate: samples are taken
at the engine's exact times over the same duration, and completions stay on the engine's clock.
When Low Power Mode changes, a window moves to another display or the display configuration
changes, running animations are re-baked from the current instant at the new rate, with the same
end. `getMotionEnvironment(target)` reports `maximumFrameRate` and the `frameRate` motion uses.

## Hidden windows

While a view's window is hidden, minimized or fully occluded (its `occlusionState` is not
visible), motion does no work for it:

* finite animations of plans with `whenHidden: 'complete'` (the default) jump to their end and
  resolve `{ finished: true }`, so state that waits for them moves on;
* infinitely repeating animations, and every animation of plans with `whenHidden: 'pause'`,
  pause where they are and resume from that instant when the window is visible again; their
  completion and cue times shift by the hidden interval.

Animations started while the window is hidden follow the same rule. `getMotionEnvironment(target)`
reports `windowVisible`.

## Lifecycle and cancellation

Unmounting a `MotionView` stops its animations, scroll links and frame recordings: `finished`
resolves `{ finished: false }` and nothing of the view stays on the main thread or the display
link. Closing a window (`NSWindowWillCloseNotification`) does the same for every `MotionView`
in it before the views unmount, so no animation of a closing window runs during its close.
System and window observers are installed only while a `MotionView` is mounted.

## Cues

`cues: [{ at, haptic, sound }]` on a plan plays a haptic (`generic`, `alignment`, `levelChange`:
`NSHapticFeedbackPattern`) and/or a system sound (`NSSound soundNamed:`, such as `Tink`) with
the frame that shows the plan at `at`: milliseconds after the plan starts, or `end` (when every
track has ended; a plan that repeats forever has no end, `E_UNSUPPORTED_OPTION`). A cue after
the plan's end is `E_INVALID_ARGUMENT`; an unknown sound `E_NOT_FOUND`. A display link runs from
two frames before the next cue and plays every cue due by the frame's target timestamp; haptics
are performed when that frame's drawing completes (`NSHapticFeedbackPerformanceTimeDrawCompleted`).
Until then a single one-shot timer waits. Under Reduce Motion, cue times scale with the
alternate (a cue halfway through the written plan plays halfway through the alternate). Cues of
an animation that is interrupted, stopped or unmounted do not play; cues of a paused animation
wait with it; cues of an animation that a hidden window completes do not play. Cues follow the
plan's first view.

## Virtual clock for the test driver

The engine reads time from one clock. The in-app test driver
([test-driver.md](test-driver.md), #52) controls it through two driver commands that
the motion package registers with `SparkTestDriverRegisterCommand`. They exist only
inside an authenticated driver session; the clock is not part of the public
JavaScript API. The clock commands and motion telemetry compile only into builds that have the driver
([test-driver.md](test-driver.md#builds)).

| Command | Fields | Effect |
| --- | --- | --- |
| `setClock` | `mode`: `virtual` or `real` | `virtual` freezes engine time and pauses every `MotionView` layer (`speed = 0`) at the current instant; views mounted later start paused. `real` shifts all scheduled work by the paused interval, resumes the layers and re-bakes them. |
| `advanceClock` | `durationMs` (> 0) | Moves engine time and every motion layer's `timeOffset` forward together, then resolves completions due by the new time. `E_UNAVAILABLE` on the real clock. |

Both reply `{ ok: true, mode, timeMs }`. With the virtual clock the window server shows the
exact frame for that instant, and driver captures render each `MotionView` at the engine's
value for it ([Motion telemetry](#motion-telemetry)), so captures and state reads are
deterministic; the flow commands `setClock` and `advanceClock` map onto them. A paused layer
also pauses its subviews' own Core Animation, such as a spinner inside a `MotionView`.
`recordMotionFrames` rejects with `E_UNAVAILABLE` on the virtual clock.

## Motion telemetry

In driver mode (the in-app test driver turns it on when it starts; it is off otherwise, so
apps record nothing) the engine records every view's latest **motion**: from the instant it
starts moving from rest until it settles (`spark::motion::Episode`). Every mutation (start, interruption, `set`,
`stop`, completion) appends to each property's history the track that drives it from then on,
so the value and velocity of any property at any time of the motion can be evaluated after
the fact, with the same solver that drove the compositor. An **interruption** is a property
that was animating and whose animation was replaced or stopped, or whose value or velocity
jumped, or a resting property that `set` gave another value: it is recorded with the state
just before and just after. A property that starts an animation from rest while others move
is not an interruption, whatever velocity it starts with, but like an interruption it is the
motion's latest event (`latestMs`), which `waitForMotion` sees. A motion keeps at most 1,024
interruptions. A motion's `end` is when its last track ends (infinity while one repeats
forever), or the instant it was stopped.

The motion package registers four driver commands. They address a view by `testID`: the
`MotionView` with it, or the `MotionView` containing the view with it (`E_NOT_FOUND`
otherwise). Times are engine milliseconds (media time on the real clock).

| Command | Fields | Reply |
| --- | --- | --- |
| `motionState` | `testID` | `values`, `velocities`, `animating` now, `clock`, `timeMs`, and `motion`: `startMs`, `endMs` (null while repeating forever), `latestMs` (start, last interruption, or last animation started during the motion), `settled`, `progress` (0-1, null while repeating forever), `afterInput`, `startValues`, `properties` (moved), `kinds` (each property's latest animation: `spring`, `timing`, `keyframes`, `decay`, `sequence`, or `jump` for a Reduce Motion change made at once), `interruptions` (`timeMs`, `property`, `before`, `after`), `truncated` (a property passed 4,096 history entries, or the motion 1,024 interruptions). `motion` is null before the view first moves. |
| `waitForMotion` | `testID`, one of `progress` (0-1), `elapsedMs` (from the motion's start) or `settled: true`; `timeoutMs` (10000) | Waits until the view's motion started, was interrupted or started another property's animation after the last driver input (`SparkTestDriverObserveInput`: input commands, `navigate`, `openFile`), then until it gets there, and replies like `motionState`. On the virtual clock it advances the clock exactly there (`E_PASSED` if the progress point is already behind); on the real clock it checks every 2 ms. `E_PASSED` when the motion settles before the progress point; `E_UNSUPPORTED_OPTION` for `progress` or `settled` of a motion that repeats forever; `E_TIMEOUT`. |
| `sampleMotion` | `testID`, `fromMs` (the motion's start), `toMs` (its end, or now), `intervalMs` (1000/120) | `samples`: `tMs`, `values`, `velocities` every `intervalMs` from `fromMs`, plus `toMs`; at most 20,000. `toMs` cannot be in the future. |
| `simulateOcclusion` | `testID`, `visible` (boolean) | The window of that view counts as hidden or visible, as a change of its occlusion state would ([Hidden windows](#hidden-windows)). Replies like `setClock`. |

`motionState` also reports `frameRate`, `hidden` and `paused` (the view's window counts as hidden;
its animations are paused) and `cues`: the view's cues of its latest motion, played (`frameMs`, the
target timestamp of the frame they played on; on the virtual clock their own time) or pending
(`frameMs` null). In a driver run cues are recorded there instead of played (`played: false`), so a
flow never makes a sound.

### Simulation in the test driver

The driver never changes the Mac's settings. A driver run pins Reduce Motion and Low Power Mode
off for motion, like the driver's other [pinned host settings](test-driver.md#pinned-host-settings),
so flows and goldens do not depend on the Mac's settings; Reduce Transparency is pinned off for
`getMotionEnvironment` too. Motion follows the simulated state other driver commands set:
`simulateSystemEvent`'s `reduceMotion` and `reduceTransparency` (`accessibilityDisplayChanged`) and
`lowPowerMode` (`lowPowerChanged`), and `simulateDisplays`' primary display's
`refreshRate.maximum` (`restore` stops simulating it). They reach motion through
`SparkTestDriverDidSimulateState`. A driven app's windows are never on screen, so motion ignores
their real occlusion there: they count as visible until `simulateOcclusion` hides them. The flow
command `assertPaused: { target, when: windowHidden }` is built on it.

A capture (the driver's `capture`) renders views in-process with `cacheDisplayInRect:`, which
draws model layer values and ignores Core Animation animations. The motion package wraps every
capture render: each `MotionView` gets its presented values (the engine's state now) while it
renders, then its model back, in one Core Animation transaction, so the window server never
sees the swap. A capture mid-motion therefore shows the motion at that instant.

The runner's `captureMotion`, `assertMotion` and `interruptAt` are built on these
([e2e-flows.md](e2e-flows.md#motion-and-frames)).
`tests/motion-engine.native.cpp` checks the history (interruptions, values after the fact, the
planned end, clock shifts); `tests/motion-coordinator.native.mm` checks waiting, exact virtual
progress points, real-clock waits, sampling and presented renders.

## Windows

Windows is typed unsupported: `getMotionAvailability()` reports
`unsupported-platform`, every operation (`getMotionEnvironment` included) fails with
`E_UNSUPPORTED_PLATFORM`, and the package declares no Windows native project. Reason: Spark's Windows native acceptance
does not exist yet (#51), and a compositor engine cannot be accepted from generated
bundles alone. The intended design reuses `spark::motion::Engine` unchanged: the glue
resolves the element's `Visual` through `ElementCompositionPreview`, converts each baked
channel into linear `KeyFrameAnimation`s on `Offset`, `Scale`,
`RotationAngleInDegrees` (centre point at half size) and `Opacity`, uses
`IterationBehavior.Forever` for loop periods and `ScrollViewer.ViewChanged` for scroll
links. Tracked in the `platform:windows` follow-up issue under #42 (#237).
The accessibility, power and lifecycle rules of this page (Reduce Motion through
`UISettings.AnimationsEnabled`, Energy Saver through `PowerManager.EnergySaverStatus`, window
visibility, cues) are part of that issue.

The visual effects, `MotionNumber`, `MotionText`, `MotionSymbol` and the symbol effects are typed
unsupported the same way (`getSymbolEffectAvailability` reports `unsupported-platform`). The engine
side carries over unchanged; the Windows glue maps `backgroundColor` onto a `ColorKeyFrameAnimation`
of a `CompositionColorBrush` (converting each sample, as on macOS), `borderRadius` and the mask onto
a `CompositionRoundedRectangleGeometry` clip, the shadow onto a `DropShadow`, `blur` onto a
`GaussianBlurEffect` brush, and `rotateX`/`rotateY`/`perspective` onto `TransformMatrix`. SF Symbols do
not exist on Windows; symbol effects there need their own design (#237). `MotionMaterial` throws
`E_UNSUPPORTED_PLATFORM` and `getMaterialAvailability` reports `unsupported-platform` until Composition backdrop
brushes are wired: the intended glue maps `withinWindow` onto `CreateBackdropBrush` and `behindWindow` onto
`CreateHostBackdropBrush` (with Acrylic-style blur and tint effects), `materialIntensity` and `materialTintOpacity` onto
the brush visual's and the tint's `Opacity`, and the crossfade onto two brush visuals (#237). `MotionShape` throws
`E_UNSUPPORTED_PLATFORM` the same way; the intended glue draws a `CompositionSpriteShape` whose `CompositionPathGeometry`
takes the baked sample paths as `PathKeyFrameAnimation` keyframes (the same point structure), with `TrimStart`/`TrimEnd`,
`StrokeThickness` and the fill and stroke `CompositionColorBrush`es as their own keyframe animations (#237).

`MotionPresence` and `MotionView`'s layout, presence and shared-element props are typed
unsupported the same way: both components throw `E_UNSUPPORTED_PLATFORM` when rendered.
Layout and shared elements will reuse `Engine::handoff` with the Windows glue comparing layout
boxes around each mounting transaction (#376).

## Tradeoffs and limits

* Sampling trades exactness between samples for one solver everywhere; 120 Hz
  linear interpolation is visually exact for UI motion, but a 10 s animation commits
  1,200 samples. Samples per bake are capped at 7,200.
* Each start, interruption or link update re-bakes the affected channel from now; a
  scroll-linked property sharing the transform channel with a running animation
  re-bakes that channel per scroll event.
* AppKit hit testing follows the model (final) transform, not the in-flight
  presentation.
* Layout boxes are layout geometry: transforms of ancestors (other than a layout-animated
  ancestor `MotionView`) are not part of them.
* Shader effects (ripple, dissolve, distortion, glass specular) and particles (#405) are not part of motion yet. Backdrop materials crossfade and fade; their
  blur radius does not animate ([Backdrop materials](#backdrop-materials)).
* Reduce Motion, the hidden-window rule and cues apply per plan; a plan with several views
  plays its cues by its first view's state.
