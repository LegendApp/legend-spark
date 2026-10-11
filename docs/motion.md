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
| `animate(target, values, { delayMs })` | Starts one plan | `MotionAnimation` |
| `stagger(targets, values, { eachMs, from, delayMs })` | Starts one plan | `MotionAnimation` |
| `timeline(steps)` | Starts one plan | `MotionAnimation` |
| `setMotionValues(target, values)` | Sets values, interrupting their animations | `Promise<void>` |
| `stopMotion(target, properties?)` | Freezes properties at their presented values | `Promise<void>` |
| `getMotionState(target)` | Presented values, velocities, animating properties | `Promise<MotionState>` |
| `linkScroll(target, options)` | Native scroll link | `Promise<AsyncRegistration>` |
| `recordMotionFrames(target, { durationMs })` | Frame telemetry | `Promise<MotionFrameReport>` |
| `getMotionAvailability()` | | `Availability` |
| `MotionView` | Component | |

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

The API is imperative and works from any code holding a `MotionView` ref.
`MotionView` is the only React-specific export (a component). There are no hooks.

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
  (`transform` and `opacity`) at 120 samples per second, linearly interpolated. The
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
`rotate` (degrees, clockwise). `scale` drives both axes and cannot be combined
with `scaleX`/`scaleY`. Velocities are units per second (multiply React Native
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

## Virtual clock for the test driver

The engine reads time from one clock. The in-app test driver
([test-driver.md](test-driver.md), #52) controls it through two driver commands that
the motion package registers with `SparkTestDriverRegisterCommand`. They exist only
inside an authenticated driver session; the clock is not part of the public
JavaScript API.

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

The engine records every view's latest **motion**: from the instant it starts moving from rest
until it settles (`spark::motion::Episode`). Every mutation (start, interruption, `set`,
`stop`, completion) appends to each property's history the track that drives it from then on,
so the value and velocity of any property at any time of the motion can be evaluated after
the fact, with the same solver that drove the compositor. An **interruption** is a property
that was animating and whose animation was replaced or stopped, or whose value or velocity
jumped (a `set`): it is recorded with the state just before and just after. A property that
starts moving while others move is not an interruption. A motion's `end` is when its last
track ends (infinity while one repeats forever), or the instant it was stopped.

The motion package registers three driver commands. They address a view by `testID`: the
`MotionView` with it, or the `MotionView` containing the view with it (`E_NOT_FOUND`
otherwise). Times are engine milliseconds (media time on the real clock).

| Command | Fields | Reply |
| --- | --- | --- |
| `motionState` | `testID` | `values`, `velocities`, `animating` now, `clock`, `timeMs`, and `motion`: `startMs`, `endMs` (null while repeating forever), `latestMs` (start or last interruption), `settled`, `progress` (0-1, null while repeating forever), `afterInput`, `startValues`, `properties` (moved), `kinds` (each property's latest animation: `spring`, `timing`, `keyframes`, `decay`, `sequence`), `interruptions` (`timeMs`, `property`, `before`, `after`), `truncated` (a property passed 4,096 history entries). `motion` is null before the view first moves. |
| `waitForMotion` | `testID`, one of `progress` (0-1), `elapsedMs` (from the motion's start) or `settled: true`; `timeoutMs` (10000) | Waits until the view's motion started or was interrupted after the last driver input (`SparkTestDriverObserveInput`: input commands, `navigate`, `openFile`), then until it gets there, and replies like `motionState`. On the virtual clock it advances the clock exactly there (`E_PASSED` if the progress point is already behind); on the real clock it checks every 2 ms. `E_PASSED` when the motion settles before the progress point; `E_UNSUPPORTED_OPTION` for `progress` or `settled` of a motion that repeats forever; `E_TIMEOUT`. |
| `sampleMotion` | `testID`, `fromMs` (the motion's start), `toMs` (its end, or now), `intervalMs` (1000/120) | `samples`: `tMs`, `values`, `velocities` every `intervalMs` from `fromMs`, plus `toMs`; at most 20,000. `toMs` cannot be in the future. |

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
`unsupported-platform`, every operation fails with `E_UNSUPPORTED_PLATFORM`, and the
package declares no Windows native project. Reason: Spark's Windows native acceptance
does not exist yet (#51), and a compositor engine cannot be accepted from generated
bundles alone. The intended design reuses `spark::motion::Engine` unchanged: the glue
resolves the element's `Visual` through `ElementCompositionPreview`, converts each baked
channel into linear `KeyFrameAnimation`s on `Offset`, `Scale`,
`RotationAngleInDegrees` (centre point at half size) and `Opacity`, uses
`IterationBehavior.Forever` for loop periods and `ScrollViewer.ViewChanged` for scroll
links. Tracked in the `platform:windows` follow-up issue under #42.

## Tradeoffs and limits

* Sampling trades exactness between samples for one solver everywhere; 120 Hz
  linear interpolation is visually exact for UI motion, but a 10 s animation commits
  1,200 samples. Samples per bake are capped at 7,200.
* Each start, interruption or link update re-bakes the affected channel from now; a
  scroll-linked property sharing the transform channel with a running animation
  re-bakes that channel per scroll event.
* AppKit hit testing follows the model (final) transform, not the in-flight
  presentation.
* Reduced motion, layout/presence transitions and visual effects belong to the
  follow-up motion tasks (#175–#177).
