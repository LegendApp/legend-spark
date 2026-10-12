#include "SparkMotion.hpp"
#include <algorithm>
#include <cmath>
#include <limits>
#include <numeric>

namespace spark::motion {
namespace {
constexpr double kInfinity = std::numeric_limits<double>::infinity();
constexpr double kMaxSettle = 60;
constexpr int kMaxSamples = 7200;

Failure invalid(std::string message) { return {"E_INVALID_ARGUMENT", std::move(message)}; }
Failure unmounted(int64_t view) { return {"E_NOT_FOUND", "No mounted MotionView has tag " + std::to_string(view), true}; }
void require(bool condition, const char *message) { if (!condition) throw invalid(message); }
bool finite(double value) { return std::isfinite(value); }
bool positive(double value) { return std::isfinite(value) && value > 0; }

void validateSpring(const SpringParams &params) {
  require(positive(params.mass) && positive(params.stiffness) && positive(params.damping), "Spring mass, stiffness and damping must be positive finite numbers");
}
void validateEasing(const Easing &easing) {
  require(easing.x1 >= 0 && easing.x1 <= 1 && easing.x2 >= 0 && easing.x2 <= 1, "Cubic Bézier x coordinates must be between 0 and 1");
  require(finite(easing.y1) && finite(easing.y2), "Cubic Bézier y coordinates must be finite");
}
bool hasDecay(const Spec &spec) {
  if (spec.kind == Spec::Kind::Decay) return true;
  return std::any_of(spec.steps.begin(), spec.steps.end(), hasDecay);
}
/** Everything a curve relies on, checked before any curve is built so malformed native input cannot crash. */
void validate(const Spec &spec) {
  require(finite(spec.to), "Animation targets must be finite numbers");
  require(!spec.velocity || finite(*spec.velocity), "velocity must be a finite number");
  require(!spec.from || (finite(spec.from->value) && finite(spec.from->velocity)), "A start state must be finite");
  require(positive(spec.restDelta) && positive(spec.restSpeed), "restDelta and restSpeed must be positive finite numbers");
  require(finite(spec.delay) && spec.delay >= 0, "delayMs must be a non-negative finite number");
  require(spec.repeat >= 0 && (std::isinf(spec.repeat) || spec.repeat == std::floor(spec.repeat)), "repeat must be a non-negative integer or Infinity");
  require((spec.repeat == 0 && !spec.reverse) || !hasDecay(spec), "Decay depends on its start velocity, so it cannot repeat or reverse");
  switch (spec.kind) {
    case Spec::Kind::Spring: validateSpring(spec.spring); break;
    case Spec::Kind::Timing:
      require(finite(spec.duration) && spec.duration >= 0, "durationMs must be a non-negative finite number");
      validateEasing(spec.easing);
      break;
    case Spec::Kind::Keyframes: {
      require(finite(spec.duration) && spec.duration >= 0, "durationMs must be a non-negative finite number");
      require(!spec.values.empty(), "Keyframes need at least one value");
      require(spec.offsets.size() == spec.values.size(), "Keyframes need one offset per value");
      require(spec.easings.size() == 1 || spec.easings.size() == spec.values.size(), "Keyframes need one easing, or one easing per value");
      double previous = 0;
      for (size_t i = 0; i < spec.values.size(); i++) {
        require(finite(spec.values[i]), "Keyframe values must be finite numbers");
        require(spec.offsets[i] > previous && spec.offsets[i] <= 1, "Keyframe offsets must increase strictly within (0, 1]");
        previous = spec.offsets[i];
      }
      require(previous == 1, "The last keyframe offset must be 1");
      for (const Easing &easing : spec.easings) validateEasing(easing);
      break;
    }
    case Spec::Kind::Decay:
      require(spec.deceleration > 0 && spec.deceleration < 1, "Decay deceleration must be between 0 and 1");
      if (spec.clamp) {
        require(finite(spec.clamp->first) && finite(spec.clamp->second) && spec.clamp->first <= spec.clamp->second, "clamp is [min, max] with finite min <= max");
        validateSpring(spec.bounce);
      }
      break;
    case Spec::Kind::Sequence: require(!spec.steps.empty(), "A sequence needs at least one step"); break;
    case Spec::Kind::Jump: break;
  }
}

class HoldCurve final : public Curve {
  double value_, duration_;
public:
  HoldCurve(double value, double duration) : value_(value), duration_(duration) {}
  double duration() const override { return duration_; }
  State at(double) const override { return {value_, 0}; }
};

/** Closed-form damped harmonic oscillator, as displacement from `to`. */
class SpringCurve final : public Curve {
  double to_, x0_, v0_, omega_, zeta_, duration_ = 0;
  State displacement(double t) const {
    const double a = zeta_ * omega_;
    if (zeta_ < 1 - 1e-9) {
      const double wd = omega_ * std::sqrt(1 - zeta_ * zeta_), e = std::exp(-a * t), c = std::cos(wd * t), s = std::sin(wd * t);
      return {e * (x0_ * c + (v0_ + a * x0_) / wd * s), e * (v0_ * c - (omega_ * omega_ * x0_ + a * v0_) / wd * s)};
    }
    if (zeta_ <= 1 + 1e-9) {
      const double e = std::exp(-omega_ * t), b = v0_ + omega_ * x0_;
      return {e * (x0_ + b * t), e * (v0_ - omega_ * b * t)};
    }
    const double r = omega_ * std::sqrt(zeta_ * zeta_ - 1), r1 = -a + r, r2 = -a - r;
    const double c1 = (v0_ - r2 * x0_) / (r1 - r2), c2 = x0_ - c1, e1 = std::exp(r1 * t), e2 = std::exp(r2 * t);
    return {c1 * e1 + c2 * e2, r1 * c1 * e1 + r2 * c2 * e2};
  }
public:
  SpringCurve(State start, double to, SpringParams params, double restDelta, double restSpeed)
    : to_(to), x0_(start.value - to), v0_(start.velocity) {
    validateSpring(params);
    omega_ = std::sqrt(params.stiffness / params.mass);
    zeta_ = params.damping / (2 * std::sqrt(params.stiffness * params.mass));
    for (int step = 0;; step++) {
      const double t = step / 1000.0;
      if (t > kMaxSettle) throw invalid("Spring does not settle within 60 seconds");
      const State s = displacement(t);
      if (std::abs(s.value) <= restDelta && std::abs(s.velocity) <= restSpeed) { duration_ = t; break; }
    }
  }
  double duration() const override { return duration_; }
  State at(double t) const override {
    if (t >= duration_) return {to_, 0};
    const State s = displacement(std::max(0.0, t));
    return {to_ + s.value, s.velocity};
  }
};

/** WebKit's UnitBezier solver. */
class Bezier {
  double ax, bx, cx, ay, by, cy;
  double x(double u) const { return ((ax * u + bx) * u + cx) * u; }
  double y(double u) const { return ((ay * u + by) * u + cy) * u; }
  double dx(double u) const { return (3 * ax * u + 2 * bx) * u + cx; }
  double dy(double u) const { return (3 * ay * u + 2 * by) * u + cy; }
  double solve(double target) const {
    double u = target;
    for (int i = 0; i < 8; i++) {
      const double error = x(u) - target, d = dx(u);
      if (std::abs(error) < 1e-9) return u;
      if (std::abs(d) < 1e-9) break;
      u -= error / d;
    }
    double lo = 0, hi = 1;
    u = target;
    while (lo < hi && hi - lo > 1e-10) {
      const double value = x(u);
      if (std::abs(value - target) < 1e-9) return u;
      (target > value ? lo : hi) = u;
      u = (lo + hi) / 2;
    }
    return u;
  }
public:
  explicit Bezier(Easing e) {
    cx = 3 * e.x1; bx = 3 * (e.x2 - e.x1) - cx; ax = 1 - cx - bx;
    cy = 3 * e.y1; by = 3 * (e.y2 - e.y1) - cy; ay = 1 - cy - by;
  }
  /** Progress and its derivative with respect to normalized time. */
  std::pair<double, double> at(double progress) const {
    const double u = solve(std::clamp(progress, 0.0, 1.0));
    // Control points on the axis make the parametric derivative 0/0 at an end; take the limit.
    const double v = std::abs(dx(u)) < 1e-9 ? std::clamp(u, 1e-6, 1 - 1e-6) : u;
    return {y(u), std::abs(dx(v)) < 1e-12 ? 0 : dy(v) / dx(v)};
  }
};

/**
 * An eased transition. A hand-off velocity that differs from the easing's own initial
 * velocity is added as `extra · t · (1 − t/D)²`: exact velocity at t = 0, zero value
 * and slope at t = D, so the easing's end and the duration are unchanged. A large
 * velocity therefore overshoots (or dips) by up to 4·D·|extra|/27 instead of being lost.
 */
class TimingCurve final : public Curve {
  double from_, to_, duration_, extra_ = 0;
  Bezier bezier_;
public:
  TimingCurve(double from, double to, double duration, Easing easing, std::optional<double> handoff)
    : from_(from), to_(to), duration_(duration), bezier_(easing) {
    if (handoff && duration_ > 0) extra_ = *handoff - (to_ - from_) * bezier_.at(0).second / duration_;
  }
  double duration() const override { return duration_; }
  State at(double t) const override {
    if (duration_ <= 0) return {to_, 0};
    t = std::clamp(t, 0.0, duration_);
    const auto [progress, slope] = bezier_.at(t / duration_);
    const double remaining = 1 - t / duration_;
    return {from_ + (to_ - from_) * progress + extra_ * t * remaining * remaining,
            (to_ - from_) * slope / duration_ + extra_ * remaining * (1 - 3 * t / duration_)};
  }
};

class DecayCurve final : public Curve {
  double x0_, v0_, k_, duration_;
public:
  DecayCurve(double x0, double v0, double k, double duration) : x0_(x0), v0_(v0), k_(k), duration_(duration) {}
  double duration() const override { return duration_; }
  State at(double t) const override {
    const double e = std::exp(-k_ * std::clamp(t, 0.0, duration_));
    return {x0_ + v0_ / k_ * (1 - e), v0_ * e};
  }
};

class SequenceCurve final : public Curve {
  std::vector<CurvePtr> parts_;
  double duration_ = 0;
public:
  explicit SequenceCurve(std::vector<CurvePtr> parts) : parts_(std::move(parts)) {
    for (const auto &part : parts_) duration_ += part->duration();
  }
  double duration() const override { return duration_; }
  State at(double t) const override {
    for (const auto &part : parts_) {
      if (t < part->duration()) return part->at(t);
      t -= part->duration();
    }
    return parts_.back()->end();
  }
  State end() const override { return parts_.back()->end(); }
};

class PlaysCurve final : public Curve {
  Plays plays_;
public:
  explicit PlaysCurve(Plays plays) : plays_(std::move(plays)) {}
  double duration() const override { return plays_.duration(); }
  State at(double t) const override { return plays_.at(t); }
  State end() const override { return plays_.end(); }
};

/** Keeps an interrupted track moving through the replacement's delay. */
class ContinueCurve final : public Curve {
  TrackPtr track_;
  double offset_, duration_;
public:
  ContinueCurve(TrackPtr track, double offset, double duration) : track_(std::move(track)), offset_(offset), duration_(duration) {}
  double duration() const override { return duration_; }
  State at(double t) const override { return track_->at(offset_ + t); }
};

/** A sequence step: its delay holds the previous step's end value, then it plays. */
CurvePtr played(const Spec &spec, State start) {
  if (std::isinf(spec.repeat)) throw invalid("A sequence step cannot repeat forever");
  std::vector<CurvePtr> parts;
  if (spec.delay > 0) { parts.push_back(std::make_shared<HoldCurve>(start.value, spec.delay)); start.velocity = 0; }
  parts.push_back(std::make_shared<PlaysCurve>(makePlays(spec, start)));
  return parts.size() == 1 ? parts[0] : std::make_shared<SequenceCurve>(parts);
}

}  // namespace

const char *propertyName(Property property) {
  static const char *names[] = {"opacity", "translateX", "translateY", "scaleX", "scaleY", "rotate"};
  return names[property];
}
std::optional<Property> propertyFromName(const std::string &name) {
  for (int i = 0; i < PropertyCount; i++) if (name == propertyName(Property(i))) return Property(i);
  return std::nullopt;
}
Channel channelOf(Property property) { return property == Opacity ? Channel::Opacity : Channel::Transform; }
Rest restThreshold(Property property) {
  switch (property) {
    case Opacity: case ScaleX: case ScaleY: return {0.0005, 0.005};
    default: return {0.01, 0.1};
  }
}

CurvePtr buildCurve(const Spec &spec, State start) {
  validate(spec);
  const double velocity = spec.velocity.value_or(start.velocity);
  // Eased curves keep their own shape from rest (at or below restSpeed); a moving property or an
  // explicit velocity starts them at exactly that velocity.
  const std::optional<double> handoff = spec.velocity || std::abs(start.velocity) > spec.restSpeed ? std::optional<double>(velocity) : std::nullopt;
  switch (spec.kind) {
    case Spec::Kind::Spring:
      return std::make_shared<SpringCurve>(State{start.value, velocity}, spec.to, spec.spring, spec.restDelta, spec.restSpeed);
    case Spec::Kind::Timing:
      return std::make_shared<TimingCurve>(start.value, spec.to, spec.duration, spec.easing, handoff);
    case Spec::Kind::Keyframes: {
      // The first segment carries the inherited velocity; later segments follow the explicit path.
      std::vector<CurvePtr> parts;
      double from = start.value, previous = 0;
      for (size_t i = 0; i < spec.values.size(); i++) {
        const Easing &easing = spec.easings.size() == 1 ? spec.easings[0] : spec.easings[i];
        parts.push_back(std::make_shared<TimingCurve>(from, spec.values[i], (spec.offsets[i] - previous) * spec.duration, easing, i == 0 ? handoff : std::nullopt));
        from = spec.values[i];
        previous = spec.offsets[i];
      }
      return std::make_shared<SequenceCurve>(parts);
    }
    case Spec::Kind::Decay: {
      const double k = -std::log(spec.deceleration) * 1000;
      if (spec.clamp && (start.value < spec.clamp->first || start.value > spec.clamp->second)) {
        const double bound = start.value < spec.clamp->first ? spec.clamp->first : spec.clamp->second;
        return std::make_shared<SpringCurve>(State{start.value, velocity}, bound, spec.bounce, spec.restDelta, spec.restSpeed);
      }
      const double rest = std::abs(velocity) > spec.restSpeed ? std::log(std::abs(velocity) / spec.restSpeed) / k : 0;
      if (spec.clamp && velocity != 0) {
        const double bound = velocity > 0 ? spec.clamp->second : spec.clamp->first;
        const double remaining = 1 - (bound - start.value) * k / velocity;
        if (remaining > 0) {
          const double crossing = -std::log(remaining) / k;
          if (crossing < rest) {
            std::vector<CurvePtr> parts{std::make_shared<DecayCurve>(start.value, velocity, k, crossing),
              std::make_shared<SpringCurve>(State{bound, velocity * remaining}, bound, spec.bounce, spec.restDelta, spec.restSpeed)};
            return std::make_shared<SequenceCurve>(parts);
          }
        }
      }
      return std::make_shared<DecayCurve>(start.value, velocity, k, rest);
    }
    case Spec::Kind::Jump:
      return std::make_shared<TimingCurve>(start.value, spec.to, 0, spec.easing, std::nullopt);
    case Spec::Kind::Sequence: {
      std::vector<CurvePtr> parts;
      State state{start.value, velocity};
      for (const Spec &step : spec.steps) {
        parts.push_back(played(step, state));
        state = parts.back()->end();
      }
      return std::make_shared<SequenceCurve>(parts);
    }
  }
  throw invalid("Unknown animation kind");
}

Plays makePlays(const Spec &spec, State start) {
  Plays plays;
  plays.first = buildCurve(spec, start);
  plays.count = spec.repeat + 1;
  plays.reverse = spec.reverse;
  const bool still = spec.velocity ? *spec.velocity == 0 : start.velocity == 0;
  if (plays.count > 1 && !still) {
    // Repeats replay the spec from rest; only the first play inherits velocity.
    Spec rest = spec;
    rest.velocity.reset();
    plays.body = buildCurve(rest, {start.value, 0});
  } else {
    plays.body = plays.first;
  }
  plays.cycle = plays.body->duration();
  return plays;
}

bool Plays::infinite() const { return std::isinf(count); }
double Plays::head() const { return first == body ? cycle : first->duration(); }
double Plays::duration() const { return head() + (infinite() ? kInfinity : (count - 1) * cycle); }
State Plays::end() const {
  if (count <= 1) return first->end();
  if (reverse && std::fmod(count - 1, 2) == 1) { const State s = body->at(0); return {s.value, -s.velocity}; }
  return body->end();
}
State Plays::at(double t) const {
  if (t < head()) return first->at(t);
  const double tau = t - head();
  if (count <= 1 || cycle <= 0 || (!infinite() && tau >= (count - 1) * cycle)) return end();
  const double index = std::floor(tau / cycle), phase = tau - index * cycle;
  // Play number index + 1: odd plays run backwards when reversing.
  if (reverse && std::fmod(index, 2) == 0) {
    const State s = body->at(cycle - phase);
    return {s.value, -s.velocity};
  }
  return body->at(phase);
}

State Track::at(double t) const {
  if (t < leadDuration) return lead ? lead->at(t) : State{startValue, 0};
  return plays.at(t - leadDuration);
}

void validateRange(const std::vector<double> &input, const std::vector<double> &output) {
  require(input.size() >= 2, "A range needs at least two input stops");
  require(output.size() == input.size(), "A range needs one output value per input stop");
  for (size_t i = 0; i < input.size(); i++) {
    require(finite(input[i]) && finite(output[i]), "Range stops must be finite numbers");
    require(i == 0 || input[i] > input[i - 1], "Range input stops must increase strictly");
  }
}

double interpolate(const std::vector<double> &input, const std::vector<double> &output, double x, bool clamp) {
  const size_t last = input.size() - 1;
  if (clamp && x <= input[0]) return output[0];
  if (clamp && x >= input[last]) return output[last];
  size_t i = 1;
  while (i < last && x > input[i]) i++;
  return output[i - 1] + (x - input[i - 1]) / (input[i] - input[i - 1]) * (output[i] - output[i - 1]);
}

void Engine::addView(int64_t view, const Values &initial) {
  Slots slots;
  for (int i = 0; i < PropertyCount; i++) slots[i].model = initial[i];
  views_[view] = slots;
}
void Engine::removeView(int64_t view, std::vector<Settled> &settled) {
  auto found = views_.find(view);
  if (found == views_.end()) return;
  for (Slot &slot : found->second) release(slot, false, settled);
  views_.erase(found);
  episodes_.erase(view);
  hidden_.erase(view);
  pausedAt_.erase(view);
  resumed_.erase(view);
}
Engine::Slots &Engine::slots(int64_t view) {
  auto found = views_.find(view);
  if (found == views_.end()) throw unmounted(view);
  return found->second;
}
State Engine::slotState(const Slot &slot, double now) {
  return slot.track ? slot.track->at(now - slot.begin) : State{slot.model, 0};
}
void Engine::release(Slot &slot, bool finished, std::vector<Settled> &settled) {
  if (!slot.track) return;
  slot.track.reset();
  auto batch = batches_.find(slot.batch);
  slot.batch.clear();
  if (batch == batches_.end()) return;
  if (!finished) batch->second.interrupted = true;
  if (--batch->second.pending == 0) {
    settled.push_back({batch->first, !batch->second.interrupted});
    batches_.erase(batch);
  }
}

namespace {
void shiftEpisode(Episode &episode, double shift) {
  episode.start += shift; episode.end += shift; episode.latest += shift;
  for (auto &segments : episode.segments) for (Segment &segment : segments) { segment.from += shift; segment.begin += shift; }
  for (Interruption &interruption : episode.interruptions) interruption.time += shift;
}
}  // namespace

double Engine::setVirtualClock(bool enabled, double realNow) {
  if (enabled == virtual_) return 0;
  virtual_ = enabled;
  if (enabled) { virtualTime_ = realNow; return 0; }
  const double shift = realNow - virtualTime_;
  for (auto &[view, slots] : views_) for (Slot &slot : slots) slot.begin += shift;
  for (auto &[view, at] : pausedAt_) at += shift;
  for (auto &[view, episode] : episodes_) shiftEpisode(episode, shift);
  return shift;
}

double Engine::timeOf(int64_t view, double now) const {
  auto found = pausedAt_.find(view);
  return found == pausedAt_.end() ? now : found->second;
}
double Engine::setHidden(int64_t view, bool hidden, double now, std::vector<Settled> &settled) {
  slots(view);
  if (hidden == (hidden_.count(view) != 0)) return 0;
  if (!hidden) {
    hidden_.erase(view);
    return resume(view, now);
  }
  sweep(now, settled);
  hidden_.insert(view);
  conceal(view, now, settled);
  return 0;
}
void Engine::conceal(int64_t view, double now, std::vector<Settled> &settled) {
  Slots &target = views_.at(view);
  const Snapshot before = snapshot(target, now);
  bool moving = false;
  for (Slot &slot : target) {
    if (!slot.track) continue;
    auto batch = batches_.find(slot.batch);
    if (slot.track->infinite() || (batch != batches_.end() && batch->second.pauseWhenHidden)) { moving = true; continue; }
    slot.model = slot.track->end().value;
    release(slot, true, settled);
  }
  observe(view, before, now);
  if (moving) pausedAt_[view] = now;
}
double Engine::resume(int64_t view, double now) {
  auto found = pausedAt_.find(view);
  if (found == pausedAt_.end()) return 0;
  const double shift = now - found->second;
  pausedAt_.erase(found);
  resumed_[view] += shift;
  for (Slot &slot : views_.at(view)) slot.begin += shift;
  auto episode = episodes_.find(view);
  if (episode != episodes_.end()) shiftEpisode(episode->second, shift);
  return shift;
}
template <typename Operation> void Engine::unpaused(const std::vector<int64_t> &views, double now, std::vector<Settled> &settled, Operation operation) {
  for (int64_t view : views) resume(view, now);
  auto hide = [&] { for (int64_t view : views) if (hidden_.count(view) && !pausedAt_.count(view)) conceal(view, now, settled); };
  try { operation(); } catch (...) { hide(); throw; }
  hide();
}
void Engine::advance(double seconds) {
  if (!virtual_) throw Failure{"E_UNAVAILABLE", "Advancing the motion clock requires the virtual clock"};
  require(positive(seconds), "The clock advances by a positive finite duration");
  virtualTime_ += seconds;
}

namespace {
int64_t loopMilliseconds(const std::array<TrackPtr, PropertyCount> &tracks, Channel channel) {
  int64_t period = 0;
  for (int i = 0; i < PropertyCount; i++) {
    const TrackPtr &track = tracks[i];
    if (!track || !track->infinite() || channelOf(Property(i)) != channel) continue;
    if (track->loopPeriod() > Engine::kMaxLoop) throw Failure{"E_UNSUPPORTED_OPTION", "Infinitely repeating animations on one view must share a cycle of at most 20 seconds"};
    const int64_t cycle = std::llround(track->loopPeriod() * 1000);
    period = period ? std::lcm(period, cycle) : cycle;
    if (period > Engine::kMaxLoop * 1000) throw Failure{"E_UNSUPPORTED_OPTION", "Infinitely repeating animations on one view must share a cycle of at most 20 seconds"};
  }
  return period;
}
}  // namespace

Started Engine::run(const Plan &plan, double now, std::vector<Settled> &settled, std::vector<int64_t> &touched) {
  std::vector<int64_t> views;
  for (const Group &group : plan.groups) views.push_back(group.view);
  Started started;
  unpaused(views, now, settled, [&] { started = start(plan, now, settled, touched); });
  return started;
}

Started Engine::start(const Plan &plan, double now, std::vector<Settled> &settled, std::vector<int64_t> &touched) {
  require(!plan.id.empty(), "Missing animation id");
  if (batches_.count(plan.id)) throw invalid("Animation id is already running");
  require(!plan.groups.empty(), "An animation needs at least one step");
  for (const Group &group : plan.groups) {
    require(!group.tracks.empty(), "Each animation step needs at least one property");
    require(!group.reduced || !group.reduced->empty(), "A Reduce Motion alternate needs at least one property");
    require(finite(group.offset), "offsetMs must be a finite number");
  }
  // Reduce Motion (docs/motion.md#reduce-motion): a step plays its own alternate, or the plan's designed one.
  const bool designed = plan.reduceMotion && plan.reduce != Reduce::Play;
  const auto played = [&](const Group &group) -> const Tracks & { return plan.reduceMotion && group.reduced ? *group.reduced : group.tracks; };
  std::unordered_set<int64_t> fading;  // views whose opacity the plan drives: the fade's own track would drive it twice
  for (const Group &group : plan.groups)
    for (const auto &[property, spec] : played(group)) if (property == Opacity) fading.insert(group.view);
  const Easing easeInOut{0.42, 0, 0.58, 1};
  std::unordered_map<int64_t, Slots> staged;
  Started started;
  double previousEnd = 0, previousPlanned = 0;
  for (const Group &group : plan.groups) {
    Slots &copy = staged.try_emplace(group.view, slots(group.view)).first->second;
    if (std::isinf(previousPlanned)) throw invalid("A timeline step cannot follow an infinitely repeating step");
    const double start = (group.afterPrevious ? previousEnd : 0) + group.offset;
    const double plannedStart = (group.afterPrevious ? previousPlanned : 0) + group.offset;
    if (start < 0 || plannedStart < 0) throw invalid("A timeline step cannot start before the timeline");
    const bool alternate = designed && !group.reduced;
    double end = start, plannedEnd = plannedStart;
    if (plan.reduceMotion) {
      // The plan as written, for cue times (each property is driven once, so the live state is its start).
      const Slots &live = slots(group.view);
      for (const auto &[property, spec] : group.tracks) {
        const double lead = plannedStart + spec.delay;
        plannedEnd = std::max(plannedEnd, lead + makePlays(spec, spec.from.value_or(slotState(live[property], now + lead))).duration());
      }
    }
    std::vector<std::shared_ptr<Track>> created, jumps;
    bool fadesOut = false, moves = false;
    double firstJump = kInfinity;
    for (const auto &[property, spec] : played(group)) {
      Slot &slot = copy[property];
      if (slot.batch == plan.id) throw invalid(std::string("One animation drives ") + propertyName(property) + " of a view once; chain steps with a sequence");
      if (slot.linked) throw Failure{"E_BUSY", std::string(propertyName(property)) + " is driven by a scroll link"};
      auto track = std::make_shared<Track>();
      track->leadDuration = start + spec.delay;
      track->startValue = spec.from ? spec.from->value : slotState(slot, now).value;
      if (slot.track && track->leadDuration > 0 && !alternate && !spec.from) track->lead = std::make_shared<ContinueCurve>(slot.track, now - slot.begin, track->leadDuration);
      const State from = spec.from.value_or(slotState(slot, alternate ? now : now + track->leadDuration));
      track->plays = makePlays(spec, from);
      track->kind = spec.kind;
      if (alternate) {
        // Nothing travels: transforms change at once, opacity fades without bounce. A loop holds where it is.
        Spec reduced;
        reduced.to = track->infinite() ? from.value : track->plays.end().value;
        reduced.easing = easeInOut;
        const bool fades = property == Opacity && plan.reduce == Reduce::Fade;
        reduced.kind = fades ? Spec::Kind::Timing : Spec::Kind::Jump;
        reduced.duration = fades ? kReducedFade : 0;
        track->plays = makePlays(reduced, {from.value, 0});
        track->kind = reduced.kind;
        if (fades) fadesOut = reduced.to < from.value;
        if (!fades) {
          jumps.push_back(track);
          firstJump = std::min(firstJump, track->leadDuration);
          moves = moves || std::abs(reduced.to - from.value) > restThreshold(property).delta;
        }
      } else if (track->infinite()) {
        track->plays.cycle = std::ceil(track->plays.cycle * 1000 - 1e-6) / 1000;
        if (track->plays.cycle <= 0) throw invalid("An infinitely repeating animation needs a non-zero duration");
      }
      slot.track = track;
      slot.begin = now;
      slot.batch = plan.id;
      created.push_back(track);
    }
    if (alternate && plan.reduce == Reduce::Fade) {
      // A view fading out keeps its place until it is gone; one that only moves fades in where it lands.
      if (fadesOut) for (auto &jump : jumps) jump->leadDuration += kReducedFade;
      Slot &opacity = copy[Opacity];
      if (moves && !fading.count(group.view) && !opacity.linked) {
        fading.insert(group.view);
        const State current = slotState(opacity, now);
        Spec fade;
        fade.kind = Spec::Kind::Timing;
        fade.to = opacity.track && !opacity.track->infinite() ? opacity.track->end().value : current.value;
        fade.duration = kReducedFade;
        fade.easing = easeInOut;
        auto track = std::make_shared<Track>();
        track->leadDuration = firstJump;
        track->startValue = current.value;
        track->plays = makePlays(fade, {0, 0});
        track->kind = Spec::Kind::Timing;
        opacity.track = track;
        opacity.begin = now;
        opacity.batch = plan.id;
        created.push_back(track);
      }
    }
    for (const auto &track : created) end = std::max(end, track->duration());
    previousEnd = end;
    previousPlanned = plan.reduceMotion ? plannedEnd : end;
    started.end = std::max(started.end, end);
    started.plannedEnd = std::max(started.plannedEnd, previousPlanned);
    started.reduced = started.reduced || (plan.reduceMotion && (alternate || group.reduced));
  }
  for (const auto &[view, copy] : staged) {
    std::array<TrackPtr, PropertyCount> tracks;
    for (int i = 0; i < PropertyCount; i++) tracks[i] = copy[i].track;
    loopMilliseconds(tracks, Channel::Opacity);
    loopMilliseconds(tracks, Channel::Transform);
  }
  const double scale = started.reduced && std::isfinite(started.plannedEnd) && started.plannedEnd > 0 ? started.end / started.plannedEnd : 1;
  for (const std::optional<double> &cue : plan.cues) {
    if (!cue) {
      if (std::isinf(started.end)) throw Failure{"E_UNSUPPORTED_OPTION", "An end cue needs an animation that ends; this one repeats forever"};
      started.cues.push_back(started.end);
      continue;
    }
    require(finite(*cue) && *cue >= 0, "Cue times must be non-negative finite numbers");
    if (*cue > started.plannedEnd + 1e-9) throw invalid("A cue cannot come after the animation ends");
    started.cues.push_back(std::min(*cue * scale, started.end));
  }
  // Valid: from here on nothing throws. Settle what finished by now, then replace only the plan's properties.
  sweep(now, settled);
  std::unordered_map<int64_t, Snapshot> before;
  for (const auto &[view, copy] : staged) before.emplace(view, snapshot(views_.at(view), now));
  int pending = 0;
  batches_[plan.id] = {0, false, plan.pauseWhenHidden};
  for (auto &[view, copy] : staged) {
    Slots &live = views_.at(view);
    for (int i = 0; i < PropertyCount; i++) {
      if (copy[i].batch != plan.id) continue;
      pending++;
      release(live[i], false, settled);
      live[i] = copy[i];
    }
    touched.push_back(view);
    observe(view, before.at(view), now);
  }
  batches_[plan.id].pending = pending;
  return started;
}

void Engine::set(int64_t view, const std::vector<std::pair<Property, double>> &values, double now, std::vector<Settled> &settled) {
  unpaused({view}, now, settled, [&] {
    Slots &target = slots(view);
    for (const auto &[property, value] : values) {
      require(finite(value), "Motion values must be finite numbers");
      if (target[property].linked) throw Failure{"E_BUSY", std::string(propertyName(property)) + " is driven by a scroll link"};
    }
    sweep(now, settled);
    const Snapshot before = snapshot(target, now);
    for (const auto &[property, value] : values) {
      release(target[property], false, settled);
      target[property].model = value;
    }
    observe(view, before, now, true);
  });
}

void Engine::stop(int64_t view, const std::vector<Property> &properties, double now, std::vector<Settled> &settled) {
  unpaused({view}, now, settled, [&] {
    Slots &target = slots(view);
    sweep(now, settled);
    const Snapshot before = snapshot(target, now);
    for (Property property : properties) {
      Slot &slot = target[property];
      slot.model = slotState(slot, now).value;
      release(slot, false, settled);
    }
    observe(view, before, now);
  });
}

void Engine::stopBatch(const std::string &id, double now, std::vector<Settled> &settled, std::vector<int64_t> &touched) {
  std::vector<int64_t> views;
  for (const auto &[view, slots] : views_)
    if (std::any_of(slots.begin(), slots.end(), [&](const Slot &slot) { return slot.track && slot.batch == id; })) views.push_back(view);
  unpaused(views, now, settled, [&] {
    sweep(now, settled);
    for (auto &[view, slots] : views_) {
      const Snapshot before = snapshot(slots, now);
      bool changed = false;
      for (Slot &slot : slots) {
        if (!slot.track || slot.batch != id) continue;
        slot.model = slotState(slot, now).value;
        release(slot, false, settled);
        changed = true;
      }
      if (!changed) continue;
      touched.push_back(view);
      observe(view, before, now);
    }
  });
}

std::optional<double> Engine::target(int64_t view, Property property) const {
  auto found = views_.find(view);
  if (found == views_.end()) throw unmounted(view);
  const Slot &slot = found->second[property];
  if (!slot.track) return slot.model;
  if (slot.track->infinite()) return std::nullopt;
  return slot.track->end().value;
}

bool Engine::handoff(int64_t view, const std::vector<std::pair<Property, State>> &from, const Spec &transition, double now, std::vector<Settled> &settled, bool reduceMotion) {
  Plan plan{"spark.handoff." + std::to_string(++handoffs_), {Group{view, {}, false, 0}}};
  plan.reduceMotion = reduceMotion;
  for (const auto &[property, state] : from) {
    const std::optional<double> to = target(view, property);
    if (!to || slots(view)[property].linked) continue;
    Spec spec = transition;
    spec.to = *to;
    spec.from = state;
    const Rest rest = restThreshold(property);
    spec.restDelta = rest.delta;
    spec.restSpeed = rest.speed;
    plan.groups[0].tracks.emplace_back(property, spec);
  }
  if (plan.groups[0].tracks.empty()) return false;
  std::vector<int64_t> touched;
  run(plan, now, settled, touched);
  return true;
}

void Engine::sweep(double now, std::vector<Settled> &settled) {
  auto due = [now](const Slot &slot) { return slot.track && !slot.track->infinite() && slot.begin + slot.track->duration() <= now + 1e-9; };
  for (auto &[view, slots] : views_) {
    if (pausedAt_.count(view) || std::none_of(slots.begin(), slots.end(), due)) continue;
    const Snapshot before = snapshot(slots, now);
    for (Slot &slot : slots)
      if (due(slot)) {
        slot.model = slot.track->end().value;
        release(slot, true, settled);
      }
    observe(view, before, now);
  }
}

Engine::Snapshot Engine::snapshot(const Slots &slots, double now) const {
  Snapshot out;
  if (!telemetry_) return out;  // observe records nothing
  for (int i = 0; i < PropertyCount; i++) {
    const Slot &slot = slots[i];
    out.tracks[i] = slot.track;
    out.states[i] = slotState(slot, now);
    out.animating[i] = slot.track && (slot.track->infinite() || now < slot.begin + slot.track->duration());
    out.moving = out.moving || out.animating[i];
  }
  return out;
}

void Engine::observe(int64_t view, const Snapshot &before, double now, bool setting) {
  if (!telemetry_) return;
  const Slots &slots = views_.at(view);
  const Snapshot after = snapshot(slots, now);
  if (!before.moving && !after.moving) return;
  auto segment = [&](int i) { return Segment{now, after.tracks[i], slots[i].begin, after.states[i].value}; };
  Episode *episode;
  // A view already moving when telemetry was turned on starts its episode here.
  if (!before.moving || !episodes_.count(view)) {
    episode = &(episodes_[view] = Episode{});
    episode->start = episode->latest = now;
    episode->event = ++events_;
    for (int i = 0; i < PropertyCount; i++) {
      episode->startValues[i] = before.states[i].value;
      episode->segments[i].push_back(segment(i));
      if (after.tracks[i]) episode->kinds[i] = after.tracks[i]->kind;
    }
  } else {
    episode = &episodes_.at(view);
    for (int i = 0; i < PropertyCount; i++) {
      const bool replaced = before.tracks[i] != after.tracks[i];
      const bool jumped = before.states[i].value != after.states[i].value || before.states[i].velocity != after.states[i].velocity;
      if (!replaced && !jumped) continue;
      if (episode->segments[i].size() < Episode::kMaxSegments) episode->segments[i].push_back(segment(i));
      else episode->truncated = true;
      if (after.tracks[i]) episode->kinds[i] = after.tracks[i]->kind;
      // A moving property replaced, stopped or set, or a resting one set to another value, is interrupted. A resting
      // property that starts an animation is not, whatever velocity the animation starts with; either way the
      // motion has a new latest event.
      const bool interrupted = (before.animating[i] && (replaced || jumped)) || (setting && before.states[i].value != after.states[i].value);
      if (interrupted) {
        if (episode->interruptions.size() < Episode::kMaxInterruptions) episode->interruptions.push_back({now, Property(i), before.states[i], after.states[i]});
        else episode->truncated = true;
      }
      if (interrupted || (replaced && after.tracks[i])) {
        episode->latest = now;
        episode->event = ++events_;
      }
    }
  }
  episode->end = now;
  for (int i = 0; i < PropertyCount; i++)
    if (after.animating[i]) episode->end = std::max(episode->end, slots[i].track->infinite() ? kInfinity : slots[i].begin + slots[i].track->duration());
}

State Episode::at(Property property, double time) const {
  const std::vector<Segment> &history = segments[property];
  auto next = std::upper_bound(history.begin(), history.end(), time, [](double t, const Segment &segment) { return t < segment.from; });
  const Segment &segment = next == history.begin() ? history.front() : *std::prev(next);
  if (!segment.track) return {segment.value, 0};
  const double t = std::max(0.0, time - segment.begin);
  return !segment.track->infinite() && t >= segment.track->duration() ? segment.track->end() : segment.track->at(t);
}

std::optional<double> Engine::nextCompletion() const {
  std::optional<double> next;
  for (const auto &[view, slots] : views_)
    for (const Slot &slot : slots)
      if (slot.track && !slot.track->infinite() && !pausedAt_.count(view)) {
        const double end = slot.begin + slot.track->duration();
        next = next ? std::min(*next, end) : end;
      }
  return next;
}

State Engine::state(int64_t view, Property property, double now) const {
  auto found = views_.find(view);
  if (found == views_.end()) throw unmounted(view);
  return slotState(found->second[property], timeOf(view, now));
}
bool Engine::animating(int64_t view, Property property, double now) const {
  auto found = views_.find(view);
  if (found == views_.end()) return false;
  now = timeOf(view, now);
  const Slot &slot = found->second[property];
  return slot.track && (slot.track->infinite() || now < slot.begin + slot.track->duration());
}

std::optional<std::pair<TrackPtr, double>> Engine::track(int64_t view, Property property) const {
  auto found = views_.find(view);
  if (found == views_.end() || !found->second[property].track) return std::nullopt;
  return std::make_pair(found->second[property].track, found->second[property].begin);
}
const Episode *Engine::episode(int64_t view) const {
  auto found = episodes_.find(view);
  return found == episodes_.end() ? nullptr : &found->second;
}
const char *kindName(Spec::Kind kind) {
  switch (kind) {
    case Spec::Kind::Spring: return "spring";
    case Spec::Kind::Timing: return "timing";
    case Spec::Kind::Keyframes: return "keyframes";
    case Spec::Kind::Decay: return "decay";
    case Spec::Kind::Sequence: return "sequence";
    case Spec::Kind::Jump: return "jump";
  }
  return "unknown";
}

ChannelBake Engine::bake(int64_t view, Channel channel, double now, double rate) const {
  require(positive(rate), "The bake rate must be positive");
  rate = std::min(rate, kSampleRate);
  const Slots &target = views_.at(view);
  auto valuesAt = [&](double time) {
    Values values;
    for (int i = 0; i < PropertyCount; i++) values[i] = slotState(target[i], time).value;
    return values;
  };
  auto sample = [&](double begin, double duration) {
    Bake bake{begin, duration, {}};
    const int count = std::clamp(int(std::ceil(duration * rate)), 1, kMaxSamples) + 1;
    bake.samples.reserve(count);
    for (int i = 0; i < count; i++) bake.samples.push_back(valuesAt(begin + duration * i / (count - 1)));
    return bake;
  };
  ChannelBake out;
  if (pausedAt_.count(view)) { out.model = valuesAt(timeOf(view, now)); return out; }
  double finiteEnd = now;
  bool active = false;
  std::array<TrackPtr, PropertyCount> tracks;
  for (int i = 0; i < PropertyCount; i++) {
    if (channelOf(Property(i)) != channel || !animating(view, Property(i), now)) continue;
    const Slot &slot = target[i];
    active = true;
    tracks[i] = slot.track;
    finiteEnd = std::max(finiteEnd, slot.begin + (slot.track->infinite() ? slot.track->loopStart() : slot.track->duration()));
  }
  out.model = valuesAt(finiteEnd);
  if (!active) return out;
  if (finiteEnd - now > 1e-6) out.lead = sample(now, finiteEnd - now);
  if (const int64_t loop = loopMilliseconds(tracks, channel)) out.loop = sample(finiteEnd, loop / 1000.0);
  return out;
}

void Engine::link(int64_t view, Property property, bool linked) { slots(view)[property].linked = linked; }
bool Engine::linked(int64_t view, Property property) const {
  auto found = views_.find(view);
  return found != views_.end() && found->second[property].linked;
}
void Engine::setModel(int64_t view, Property property, double value) { slots(view)[property].model = value; }

}  // namespace spark::motion
