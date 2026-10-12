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
| `getMotionEnvironment(target?)` | Reduce Motion, Low Power Mode, frame rate, window visibility | `Promise<MotionEnvironment>` |
| `getMotionAvailability()` | | `Availability` |
| `MotionView` | Component: `initial`, `enter`, `exit`, `layout`, `sharedId`, `transition` | |
| `MotionPresence` | Component: keeps removed children mounted while they exit | |

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

The API is imperative and works from any code holding a `MotionView` ref.
`MotionView` and `MotionPresence` are the only React-specific exports (components). There
are no hooks.

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
  (`transform` and `opacity`) at the display's frame rate (at most 120 samples per second;
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
starts: a running animation is not changed when the user toggles it. `getMotionEnvironment()`
reports the setting for code that chooses different content rather than different motion. The
engine marks changes made at once as kind `jump` in [motion telemetry](#motion-telemetry).

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

The driver never changes the Mac's settings. Motion follows the simulated state other driver
commands set: `simulateSystemEvent`'s `reduceMotion` (`accessibilityDisplayChanged`) and
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
* Visual effects belong to the follow-up motion task #176.
* Reduce Motion, the hidden-window rule and cues apply per plan; a plan with several views
  plays its cues by its first view's state.
