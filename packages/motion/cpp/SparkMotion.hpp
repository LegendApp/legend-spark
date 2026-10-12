// Portable motion solver and scheduler. No platform types: the macOS glue (and the
// future Windows glue) feed it plans and engine time, then hand baked samples to
// the compositor. See docs/motion.md.
#pragma once
#include <array>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace spark::motion {

enum Property : int { Opacity, TranslateX, TranslateY, ScaleX, ScaleY, Rotate, PropertyCount };
using Values = std::array<double, PropertyCount>;
constexpr Values kIdentity = {1, 0, 0, 1, 1, 0};
const char *propertyName(Property property);
std::optional<Property> propertyFromName(const std::string &name);

/** One property's channel on the compositor. Transform properties bake together. */
enum class Channel { Opacity, Transform };
Channel channelOf(Property property);

/** When a spring or decay counts as settled: displacement below `delta`, speed below `speed` (units per second). */
struct Rest { double delta, speed; };
/** Per-property defaults: points and degrees settle at 0.01, opacity and scale at 0.0005. */
Rest restThreshold(Property property);

struct State { double value = 0, velocity = 0; };
struct SpringParams { double mass = 1, stiffness = 100, damping = 20; };
struct Easing { double x1 = 0, y1 = 0, x2 = 1, y2 = 1; };

/** An animation description. Times are seconds. buildCurve validates it. */
struct Spec {
  enum class Kind { Spring, Timing, Keyframes, Decay, Sequence } kind = Kind::Spring;
  double to = 0;
  SpringParams spring;
  std::optional<double> velocity;  // explicit velocity overrides the inherited one
  std::optional<State> from;  // start state instead of the current one (layout and shared-element hand-offs)
  double restDelta = 0.01, restSpeed = 0.1;
  double duration = 0.25;
  Easing easing{0.25, 0.1, 0.25, 1};
  std::vector<double> values, offsets;
  std::vector<Easing> easings;  // one, or one per keyframe segment
  double deceleration = 0.998;  // per millisecond
  std::optional<std::pair<double, double>> clamp;
  SpringParams bounce;
  std::vector<Spec> steps;
  double delay = 0;
  double repeat = 0;  // extra plays; may be infinity
  bool reverse = false;
};

class Curve {
public:
  virtual ~Curve() = default;
  virtual double duration() const = 0;
  /** Value and velocity at t in [0, duration]. */
  virtual State at(double t) const = 0;
  /** Exact end state, including the velocity the curve ends with. */
  virtual State end() const { return at(duration()); }
};
using CurvePtr = std::shared_ptr<const Curve>;

/** `unmounted`: the request names a view that is not registered (yet); the glue may wait for its mount. */
struct Failure { std::string code, message; bool unmounted = false; };

/** Builds the single-play curve for a spec starting from `start`. Throws Failure for an invalid spec. */
CurvePtr buildCurve(const Spec &spec, State start);

/**
 * A spec's plays: `first` carries the inherited velocity, later plays repeat `body`
 * (the same spec from rest) every `cycle`, alternating direction when `reverse`.
 */
struct Plays {
  CurvePtr first, body;
  double cycle = 0, count = 1;
  bool reverse = false;
  bool infinite() const;
  /** The first play's span: a full cycle when it is the body itself. */
  double head() const;
  double duration() const;
  State at(double t) const;
  State end() const;
};
Plays makePlays(const Spec &spec, State start);

/** One property's scheduled motion: optional lead-in (delay), then its plays. */
struct Track {
  CurvePtr lead;  // continues the interrupted track during the delay; null holds `startValue`
  double leadDuration = 0;
  double startValue = 0;
  Plays plays;
  Spec::Kind kind = Spec::Kind::Spring;  // the spec's kind, for telemetry
  bool infinite() const { return plays.infinite(); }
  double duration() const { return leadDuration + plays.duration(); }
  /** An infinite track is periodic from here on, with `loopPeriod()`. */
  double loopStart() const { return leadDuration + (plays.first == plays.body ? 0 : plays.head()); }
  double loopPeriod() const { return plays.cycle * (plays.reverse ? 2 : 1); }
  State at(double t) const;
  State end() const { return {plays.end().value, 0}; }
};
using TrackPtr = std::shared_ptr<const Track>;

struct Group {
  int64_t view = 0;
  std::vector<std::pair<Property, Spec>> tracks;
  bool afterPrevious = false;
  double offset = 0;
};
struct Plan { std::string id; std::vector<Group> groups; };
const char *kindName(Spec::Kind kind);

/** From `from` on, a property follows `track` (begun at `begin`), or holds `value` when there is none. */
struct Segment { double from = 0; TrackPtr track; double begin = 0; double value = 0; };
/** A moving property whose animation was replaced, stopped or set: its state just before and just after. */
struct Interruption { double time = 0; Property property = Opacity; State before, after; };
/**
 * Telemetry of a view's latest motion: from the instant it started moving from rest until it settles. Every
 * property's history is kept as segments, so its value and velocity at any time of the motion can be evaluated
 * after the fact (docs/motion.md#motion-telemetry).
 */
struct Episode {
  static constexpr size_t kMaxSegments = 4096;
  static constexpr size_t kMaxInterruptions = 1024;
  double start = 0;
  double end = 0;     // when it settles (or settled): the latest track end, or a stop; infinity while a track repeats forever
  double latest = 0;  // the start, the last interruption, or the last animation started during the motion
  uint64_t event = 0; // Engine::events() at `latest`
  Values startValues{};
  std::array<std::vector<Segment>, PropertyCount> segments;
  std::array<std::optional<Spec::Kind>, PropertyCount> kinds;  // the kind of each property's latest animation
  std::vector<Interruption> interruptions;
  bool truncated = false;  // a property exceeded kMaxSegments or the motion kMaxInterruptions; later history was not kept
  State at(Property property, double time) const;
};
struct Settled { std::string id; bool finished; };

struct Bake {
  double begin = 0, duration = 0;
  std::vector<Values> samples;
};
struct ChannelBake {
  std::optional<Bake> lead;  // finite part, from now
  std::optional<Bake> loop;  // repeats forever after `lead`
  Values model{};           // value the compositor model holds after the lead
};

/** Throws Failure unless `input` has at least two strictly increasing finite stops and `output` matches it. */
void validateRange(const std::vector<double> &input, const std::vector<double> &output);
/** Piecewise-linear map over a range accepted by validateRange. */
double interpolate(const std::vector<double> &input, const std::vector<double> &output, double x, bool clamp);

class Engine {
public:
  static constexpr double kSampleRate = 120;
  static constexpr double kMaxLoop = 20;

  void addView(int64_t view, const Values &initial);
  /** Forgets a view; its animations settle unfinished. */
  void removeView(int64_t view, std::vector<Settled> &settled);
  bool hasView(int64_t view) const { return views_.count(view) != 0; }

  // Clock. Engine time is the compositor's media time in real mode.
  bool virtualClock() const { return virtual_; }
  double virtualTime() const { return virtualTime_; }
  double time(double realNow) const { return virtual_ ? virtualTime_ : realNow; }
  /** Returns the time shift applied to scheduled work (non-zero when resuming real time). */
  double setVirtualClock(bool enabled, double realNow);
  /** Moves the virtual clock forward; `seconds` must be positive and finite. */
  void advance(double seconds);

  /** Validates the whole plan before any side effect. Touched views need re-baking. */
  void run(const Plan &plan, double now, std::vector<Settled> &settled, std::vector<int64_t> &touched);
  void set(int64_t view, const std::vector<std::pair<Property, double>> &values, double now, std::vector<Settled> &settled);
  void stop(int64_t view, const std::vector<Property> &properties, double now, std::vector<Settled> &settled);
  void stopBatch(const std::string &id, double now, std::vector<Settled> &settled, std::vector<int64_t> &touched);
  /**
   * Layout and shared-element hand-off (docs/motion.md#layout-presence-and-shared-elements): each property jumps to
   * `from` (value and velocity) and runs `transition` to the value it was heading for (its animation's end, or its
   * value at rest). Animations it replaces settle unfinished. A property driven by a scroll link or repeating forever
   * is left alone. Returns false when no property was handed off.
   */
  bool handoff(int64_t view, const std::vector<std::pair<Property, State>> &from, const Spec &transition, double now, std::vector<Settled> &settled);
  /** The value a property settles at: its animation's end, or its value at rest; none while it repeats forever. */
  std::optional<double> target(int64_t view, Property property) const;
  /** Settles tracks that ended by `now`. */
  void sweep(double now, std::vector<Settled> &settled);
  std::optional<double> nextCompletion() const;
  bool pending(const std::string &id) const { return batches_.count(id) != 0; }

  State state(int64_t view, Property property, double now) const;
  bool animating(int64_t view, Property property, double now) const;
  /** The property's track until it is replaced, stopped or swept (it may have ended by `now`), and its begin time. */
  std::optional<std::pair<TrackPtr, double>> track(int64_t view, Property property) const;
  /** Records each view's latest motion from now on (off by default: the in-app test driver turns it on), or stops and forgets them. */
  void setTelemetry(bool enabled) { telemetry_ = enabled; if (!enabled) episodes_.clear(); }
  /** The view's latest motion, or null when it has not moved since it was added or telemetry is off. */
  const Episode *episode(int64_t view) const;
  /** Counts motion starts, interruptions and animations started during a motion, of every view; an episode's `event` is the count at its latest one. */
  uint64_t events() const { return events_; }
  ChannelBake bake(int64_t view, Channel channel, double now) const;

  void link(int64_t view, Property property, bool linked);
  bool linked(int64_t view, Property property) const;
  void setModel(int64_t view, Property property, double value);

private:
  struct Slot { double model = 0; TrackPtr track; double begin = 0; std::string batch; bool linked = false; };
  using Slots = std::array<Slot, PropertyCount>;
  struct Batch { int pending = 0; bool interrupted = false; };
  struct Snapshot { std::array<TrackPtr, PropertyCount> tracks; std::array<State, PropertyCount> states; std::array<bool, PropertyCount> animating{}; bool moving = false; };
  Snapshot snapshot(const Slots &slots, double now) const;
  /** Records what a mutation at `now` changed in the view's motion (docs/motion.md#motion-telemetry); `setting` for `set`. */
  void observe(int64_t view, const Snapshot &before, double now, bool setting = false);
  void release(Slot &slot, bool finished, std::vector<Settled> &settled);
  static State slotState(const Slot &slot, double now);
  Slots &slots(int64_t view);
  std::unordered_map<int64_t, Slots> views_;
  std::unordered_map<std::string, Batch> batches_;
  std::unordered_map<int64_t, Episode> episodes_;
  uint64_t events_ = 0;
  uint64_t handoffs_ = 0;
  bool telemetry_ = false;
  bool virtual_ = false;
  double virtualTime_ = 0;
};

}  // namespace spark::motion
