#include "SparkMotion.hpp"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
using namespace spark::motion;

static int failures = 0;
#define CHECK(condition) do { if (!(condition)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #condition); failures++; } } while (0)
static bool near(double a, double b, double tolerance) { return std::abs(a - b) <= tolerance; }

static Spec springTo(double to, double responseSeconds = 0.5, double bounce = 0) {
  Spec spec;
  spec.kind = Spec::Kind::Spring;
  spec.to = to;
  const double ratio = bounce >= 0 ? 1 - bounce : 1 / (1 + bounce);
  spec.spring = {1, std::pow(2 * M_PI / responseSeconds, 2), 4 * M_PI * ratio / responseSeconds};
  return spec;
}
static Spec timingTo(double to, double duration, Easing easing = {0.42, 0, 0.58, 1}) {
  Spec spec;
  spec.kind = Spec::Kind::Timing;
  spec.to = to;
  spec.duration = duration;
  spec.easing = easing;
  return spec;
}
static Plan plan(std::string id, int64_t view, Property property, Spec spec) {
  Plan result{std::move(id), {}};
  result.groups.push_back({view, {{property, spec}}, false, 0});
  return result;
}
static void checkDerivative(const Curve &curve) {
  for (double t = 0.01; t < curve.duration() - 0.01; t += 0.037) {
    const double h = 1e-5, numeric = (curve.at(t + h).value - curve.at(t - h).value) / (2 * h);
    CHECK(near(curve.at(t).velocity, numeric, 1e-3 * std::max(1.0, std::abs(numeric))));
  }
}

int main() {
  // Springs: closed form for every damping regime, analytic velocity, exact settle.
  for (double bounce : {0.4, 0.0, -0.5}) {
    CurvePtr curve = buildCurve(springTo(100, 0.4, bounce), {0, 250});
    CHECK(curve->duration() > 0.2 && curve->duration() < 5);
    CHECK(curve->at(curve->duration()).value == 100);
    checkDerivative(*curve);
  }
  CurvePtr bouncy = buildCurve(springTo(100, 0.5, 0.4), {0, 0});
  double peak = 0;
  for (double t = 0; t < bouncy->duration(); t += 0.001) peak = std::max(peak, bouncy->at(t).value);
  CHECK(peak > 105);
  CurvePtr smooth = buildCurve(springTo(100, 0.5, 0), {0, 0});
  for (double t = 0; t < smooth->duration(); t += 0.001) CHECK(smooth->at(t).value <= 100 + 1e-9);
  try { Spec spec = springTo(1); spec.spring.damping = 0; buildCurve(spec, {0, 0}); CHECK(false); }
  catch (const Failure &failure) { CHECK(failure.code == "E_INVALID_ARGUMENT"); }

  // Timing, keyframes, decay and sequences.
  CurvePtr timing = buildCurve(timingTo(10, 0.3), {0, 0});
  CHECK(timing->duration() == 0.3 && near(timing->at(0.15).value, 5, 1e-6) && timing->at(0.3).value == 10);
  checkDerivative(*timing);
  Spec frames;
  frames.kind = Spec::Kind::Keyframes;
  frames.duration = 1;
  frames.values = {10, -10, 0};
  frames.offsets = {0.25, 0.75, 1};
  frames.easings = {{0, 0, 1, 1}};
  CurvePtr keyframes = buildCurve(frames, {0, 0});
  CHECK(near(keyframes->at(0.25).value, 10, 1e-9) && near(keyframes->at(0.5).value, 0, 1e-9) && near(keyframes->at(0.75).value, -10, 1e-9));
  Spec fling;
  fling.kind = Spec::Kind::Decay;
  fling.restSpeed = 0.5;
  CurvePtr decay = buildCurve(fling, {0, 1000});
  CHECK(near(decay->end().value, 1000 / (-std::log(0.998) * 1000), 0.5));
  checkDerivative(*decay);
  fling.clamp = std::make_pair(0.0, 100.0);
  fling.bounce = springTo(0, 0.3).spring;
  CurvePtr clamped = buildCurve(fling, {0, 1000});
  CHECK(clamped->end().value == 100);
  for (double t = 0; t < clamped->duration(); t += 0.001) {
    const double h = 1e-4;
    if (t > h) CHECK(near(clamped->at(t).value, clamped->at(t - h).value, 1000 * h * 1.01));  // continuous at the crossing
  }
  Spec chain;
  chain.kind = Spec::Kind::Sequence;
  chain.steps = {timingTo(50, 0.2, {0, 0, 1, 1}), springTo(0, 0.3)};
  CurvePtr sequence = buildCurve(chain, {0, 0});
  CHECK(near(sequence->at(0.1).value, 25, 1e-6) && sequence->end().value == 0);
  CHECK(near(sequence->at(0.2 + 1e-6).velocity, 250, 1));  // the spring step inherits the timing step's end velocity


  // Velocity hand-off is exact for every kind, however large: 11,537 pt/s into a 250 ms timing, a
  // timing whose target equals the current value, keyframes, and a repeating animation's first play.
  for (Easing easing : {Easing{0.42, 0, 0.58, 1}, Easing{0, 0, 1, 1}, Easing{0.4, 0, 0.2, 1}, Easing{0, 0, 0.58, 1}}) {
    CurvePtr fast = buildCurve(timingTo(200, 0.25, easing), {10, 11537});
    CHECK(near(fast->at(0).velocity, 11537, 1e-6) && fast->at(0.25).value == 200);
    CHECK(near(fast->at(0.25 - 1e-7).value, 200, 1e-3));  // the correction vanishes at the end
    checkDerivative(*fast);
  }
  CurvePtr bump = buildCurve(timingTo(5, 0.3), {5, -800});
  CHECK(near(bump->at(0).velocity, -800, 1e-9) && bump->at(0.1).value < 5 && bump->end().value == 5);
  Spec path;
  path.kind = Spec::Kind::Keyframes;
  path.duration = 0.6;
  path.values = {40, 0};
  path.offsets = {0.5, 1};
  path.easings = {{0.42, 0, 0.58, 1}};
  CurvePtr pathCurve = buildCurve(path, {0, 3000});
  CHECK(near(pathCurve->at(0).velocity, 3000, 1e-6) && near(pathCurve->at(0.3).value, 40, 1e-9) && pathCurve->end().value == 0);
  Spec looping = timingTo(1, 0.2, {0, 0, 1, 1});
  looping.repeat = 3;
  Plays plays = makePlays(looping, {0, 40});
  CHECK(near(plays.at(0).velocity, 40, 1e-9) && near(plays.at(0.25).value, 0.25, 1e-9) && near(plays.at(0.25).velocity, 5, 1e-9));
  CHECK(plays.first != plays.body && near(plays.duration(), 0.8, 1e-12) && plays.end().value == 1);
  const Plays still = makePlays(looping, {0, 0});
  CHECK(still.first == still.body && near(still.at(0.1).value, 0.5, 1e-9));  // from rest the easing is exact

  // Per-property rest thresholds: opacity and scale settle within 0.0005 of the target, points within 0.01.
  CHECK(restThreshold(Opacity).delta == 0.0005 && restThreshold(ScaleX).delta == 0.0005 && restThreshold(TranslateY).delta == 0.01 && restThreshold(Rotate).delta == 0.01);
  Spec fade = springTo(1, 0.5, 0);
  fade.restDelta = restThreshold(Opacity).delta;
  fade.restSpeed = restThreshold(Opacity).speed;
  CurvePtr faded = buildCurve(fade, {0, 0});
  const State nearlyDone = faded->at(faded->duration() - 0.001);
  CHECK(std::abs(nearlyDone.value - 1) <= 0.0006 && faded->duration() > buildCurve(springTo(1, 0.5, 0), {0, 0})->duration());

  // Malformed specs fail as Failure (never std::out_of_range or a crash) before any side effect.
  auto rejects = [](Spec spec, const char *code = "E_INVALID_ARGUMENT") {
    try { buildCurve(spec, {0, 0}); return false; }
    catch (const Failure &failure) { return failure.code == code; }
  };
  Spec bad = frames;
  bad.easings.clear();
  CHECK(rejects(bad));
  bad = frames; bad.easings = {{0, 0, 1, 1}, {0, 0, 1, 1}};
  CHECK(rejects(bad));
  bad = frames; bad.offsets = {0.5, 0.25, 1};
  CHECK(rejects(bad));
  bad = frames; bad.offsets = {0.25, 0.75, 0.9};
  CHECK(rejects(bad));
  bad = frames; bad.offsets = {0, 0.5, 1};
  CHECK(rejects(bad));
  bad = frames; bad.offsets = {0.5, 1};
  CHECK(rejects(bad));
  bad = frames; bad.values.clear(); bad.offsets.clear();
  CHECK(rejects(bad));
  CHECK(rejects(timingTo(1, -0.1)));
  CHECK(rejects(timingTo(1, std::numeric_limits<double>::infinity())));
  CHECK(rejects(timingTo(1, 0.2, {1.2, 0, 0.5, 1})) && rejects(timingTo(1, 0.2, {0.2, 0, -0.1, 1})));
  CHECK(rejects(timingTo(std::nan(""), 0.2)));
  bad = timingTo(1, 0.2); bad.delay = -1;
  CHECK(rejects(bad));
  bad = timingTo(1, 0.2); bad.repeat = 1.5;
  CHECK(rejects(bad));
  bad = springTo(1); bad.restDelta = 0;
  CHECK(rejects(bad));
  bad = fling; bad.repeat = 1;
  CHECK(rejects(bad));
  bad = chain; bad.steps.push_back(fling); bad.reverse = true;
  CHECK(rejects(bad));
  bad = chain; bad.steps.clear();
  CHECK(rejects(bad));
  bad = fling; bad.clamp = std::make_pair(10.0, 0.0);
  CHECK(rejects(bad));
  bad = fling; bad.deceleration = 1;
  CHECK(rejects(bad));
  try { validateRange({}, {}); CHECK(false); } catch (const Failure &failure) { CHECK(failure.code == "E_INVALID_ARGUMENT"); }
  try { validateRange({0, 100}, {1}); CHECK(false); } catch (const Failure &failure) { CHECK(failure.code == "E_INVALID_ARGUMENT"); }
  try { validateRange({0, 0}, {1, 2}); CHECK(false); } catch (const Failure &failure) { CHECK(failure.code == "E_INVALID_ARGUMENT"); }
  validateRange({0, 50, 100}, {0, 10, 0});

  Engine engine;
  engine.setTelemetry(true);
  std::vector<Settled> settled;
  std::vector<int64_t> touched;
  engine.addView(1, kIdentity);
  engine.addView(2, kIdentity);

  // Interruption keeps value and velocity; the interrupted animation settles unfinished.
  engine.run(plan("a", 1, TranslateX, springTo(200)), 10, settled, touched);
  const State before = engine.state(1, TranslateX, 10.1);
  CHECK(before.velocity > 100);
  engine.run(plan("b", 1, TranslateX, springTo(0)), 10.1, settled, touched);
  CHECK(settled.size() == 1 && settled[0].id == "a" && !settled[0].finished);
  const State after = engine.state(1, TranslateX, 10.1);
  CHECK(near(after.value, before.value, 1e-9) && near(after.velocity, before.velocity, 1e-9));
  // A timing replacement starts with exactly the inherited velocity.
  const State moving = engine.state(1, TranslateX, 10.15);
  engine.run(plan("c", 1, TranslateX, timingTo(-50, 0.4)), 10.15, settled, touched);
  const State timed = engine.state(1, TranslateX, 10.15);
  CHECK(near(timed.value, moving.value, 1e-9) && near(timed.velocity, moving.velocity, 1e-6 * std::abs(moving.velocity)));
  // An explicit velocity (gesture release) overrides the inherited one.
  Spec release = springTo(0);
  release.velocity = -3000;
  engine.run(plan("d", 1, TranslateX, release), 10.2, settled, touched);
  CHECK(near(engine.state(1, TranslateX, 10.2).velocity, -3000, 1e-6));
  // During a delay the interrupted motion continues.
  const double continuing = engine.state(1, TranslateX, 10.3).value;
  Spec delayed = springTo(500);
  delayed.delay = 0.1;
  engine.run(plan("e", 1, TranslateX, delayed), 10.25, settled, touched);
  CHECK(near(engine.state(1, TranslateX, 10.3).value, continuing, 1e-9));
  // stop() freezes the presented value.
  const double frozen = engine.state(1, TranslateX, 10.5).value;
  engine.stop(1, {TranslateX}, 10.5, settled);
  CHECK(settled.back().id == "e" && !settled.back().finished);
  CHECK(engine.state(1, TranslateX, 11).value == frozen && !engine.animating(1, TranslateX, 11));

  CHECK(!engine.track(1, TranslateX) && !engine.track(99, TranslateX));

  // Completion: a sweep settles finished animations exactly once, at nextCompletion().
  settled.clear();
  engine.run(plan("f", 1, Opacity, timingTo(0, 0.25)), 20, settled, touched);
  // Telemetry reads the driving track: begin, duration, kind; the track identity changes when it is replaced.
  const auto fading = engine.track(1, Opacity);
  CHECK(fading && fading->second == 20 && near(fading->first->duration(), 0.25, 1e-12) && fading->first->kind == Spec::Kind::Timing && std::string(kindName(fading->first->kind)) == "timing");
  CHECK(engine.nextCompletion() && near(*engine.nextCompletion(), 20.25, 1e-9));
  engine.sweep(20.2, settled);
  CHECK(settled.empty());
  engine.sweep(20.25, settled);
  CHECK(settled.size() == 1 && settled[0].finished && engine.state(1, Opacity, 21).value == 0);
  CHECK(!engine.track(1, Opacity));  // swept
  engine.run(plan("f2", 2, Opacity, timingTo(0, 0.25)), 20, settled, touched);
  const auto replaced = engine.track(2, Opacity);
  engine.run(plan("f3", 2, Opacity, springTo(1)), 20.1, settled, touched);
  CHECK(engine.track(2, Opacity)->first != replaced->first && engine.track(2, Opacity)->first->kind == Spec::Kind::Spring && engine.track(2, Opacity)->second == 20.1);
  engine.stop(2, {Opacity}, 20.1, settled);
  CHECK(!engine.track(2, Opacity));
  settled.clear();

  // Repeat and reverse.
  Spec pulse = timingTo(2, 0.5, {0, 0, 1, 1});
  pulse.repeat = 2;
  pulse.reverse = true;
  engine.run(plan("g", 1, ScaleX, pulse), 30, settled, touched);
  CHECK(near(engine.state(1, ScaleX, 30.75).value, 1.5, 1e-6) && engine.state(1, ScaleX, 30.75).velocity < 0);
  CHECK(engine.state(1, ScaleX, 31.5).value == 2);
  pulse.repeat = 1;
  engine.run(plan("h", 1, ScaleY, pulse), 30, settled, touched);
  CHECK(!engine.track(1, ScaleX)->first->infinite() && engine.track(1, ScaleY)->first->kind == Spec::Kind::Timing);
  CHECK(engine.state(1, ScaleY, 31.5).value == 1);

  // Timelines: a step after the previous one starts at its natively solved end; staggers offset from the start.
  settled.clear();
  Plan timeline{"t", {}};
  timeline.groups.push_back({1, {{TranslateY, timingTo(10, 0.2)}}, false, 0});
  timeline.groups.push_back({2, {{TranslateY, springTo(10)}}, true, 0.05});
  engine.run(timeline, 40, settled, touched);
  CHECK(engine.state(2, TranslateY, 40.24).value == 0 && engine.state(2, TranslateY, 40.3).value > 0);
  Plan stagger{"s", {}};
  for (int64_t view : {1, 2}) stagger.groups.push_back({view, {{Rotate, timingTo(90, 0.1)}}, false, (view - 1) * 0.05});
  engine.run(stagger, 50, settled, touched);
  CHECK(engine.state(1, Rotate, 50.1).value == 90 && engine.state(2, Rotate, 50.1).value < 90);
  Plan infinite{"i", {}};
  Spec spin = timingTo(360, 1, {0, 0, 1, 1});
  spin.repeat = std::numeric_limits<double>::infinity();
  infinite.groups.push_back({1, {{Rotate, spin}}, false, 0});
  infinite.groups.push_back({2, {{Rotate, springTo(0)}}, true, 0});
  try { engine.run(infinite, 60, settled, touched); CHECK(false); }
  catch (const Failure &failure) { CHECK(failure.code == "E_INVALID_ARGUMENT"); }
  CHECK(!engine.pending("i"));
  try { engine.run(plan("x", 99, Rotate, spin), 60, settled, touched); CHECK(false); }
  catch (const Failure &failure) { CHECK(failure.code == "E_NOT_FOUND"); }
  // A plan whose steps have no properties would never settle: it is rejected and the id stays free.
  Plan empty{"empty", {{1, {}, false, 0}, {2, {}, true, 0}}};
  try { engine.run(empty, 60, settled, touched); CHECK(false); }
  catch (const Failure &failure) { CHECK(failure.code == "E_INVALID_ARGUMENT"); }
  CHECK(!engine.pending("empty"));
  try { engine.run(Plan{"none", {}}, 60, settled, touched); CHECK(false); }
  catch (const Failure &failure) { CHECK(failure.code == "E_INVALID_ARGUMENT"); }
  // A plan drives each property of a view once; a second step for it would silently replace the first.
  Plan twice{"twice", {{1, {{Opacity, timingTo(0, 0.1)}}, false, 0}, {1, {{Opacity, timingTo(1, 0.1)}}, true, 0}}};
  try { engine.run(twice, 60, settled, touched); CHECK(false); }
  catch (const Failure &failure) { CHECK(failure.code == "E_INVALID_ARGUMENT"); }
  CHECK(!engine.pending("twice"));
  // A rejected plan has no side effects: an animation that finished meanwhile still settles through the next sweep.
  engine.run(plan("done", 2, ScaleY, timingTo(1.5, 0.05)), 60, settled, touched);
  settled.clear();
  try { engine.run(plan("rejected", 2, TranslateY, timingTo(1, -1)), 61, settled, touched); CHECK(false); } catch (const Failure &) {}
  CHECK(settled.empty());
  engine.sweep(61, settled);
  CHECK(settled.size() == 1 && settled[0].id == "done" && settled[0].finished);
  try { engine.run(plan("ghost", 404, Opacity, timingTo(1, 1)), 61, settled, touched); CHECK(false); }
  catch (const Failure &failure) { CHECK(failure.code == "E_NOT_FOUND" && failure.unmounted); }
  // An invalid track in a later step leaves earlier views untouched.
  const double untouched = engine.state(1, TranslateX, 60).value;
  Plan partial{"partial", {{1, {{TranslateX, springTo(500)}}, false, 0}, {2, {{TranslateX, timingTo(1, -1)}}, false, 0}}};
  try { engine.run(partial, 60, settled, touched); CHECK(false); } catch (const Failure &) {}
  CHECK(engine.state(1, TranslateX, 60).value == untouched && !engine.animating(1, TranslateX, 60) && !engine.pending("partial"));

  // Baking: a finite lead plus a loop at the least common multiple of infinite cycles.
  engine.run(plan("j", 1, Rotate, spin), 60, settled, touched);
  CHECK(engine.track(1, Rotate)->first->infinite() && std::isinf(engine.episode(1)->end));
  Spec wobble = timingTo(1.2, 0.75, {0, 0, 1, 1});
  wobble.repeat = std::numeric_limits<double>::infinity();
  wobble.reverse = true;
  engine.run(plan("k", 1, ScaleX, wobble), 60, settled, touched);
  ChannelBake baked = engine.bake(1, Channel::Transform, 60);
  CHECK(!baked.lead && baked.loop && near(baked.loop->duration, 3, 1e-9) && baked.loop->samples.size() == 361);
  CHECK(near(baked.loop->samples.front()[Rotate], baked.loop->samples.back()[Rotate], 1e-6));
  Spec odd = timingTo(2, 7.001, {0, 0, 1, 1});
  odd.repeat = std::numeric_limits<double>::infinity();
  try { engine.run(plan("l", 1, ScaleY, odd), 60, settled, touched); CHECK(false); }
  catch (const Failure &failure) { CHECK(failure.code == "E_UNSUPPORTED_OPTION"); }
  Spec endless = timingTo(2, 1e12, {0, 0, 1, 1});  // a cycle far beyond int64 milliseconds must not overflow
  endless.repeat = std::numeric_limits<double>::infinity();
  try { engine.run(plan("l2", 1, ScaleY, endless), 60, settled, touched); CHECK(false); }
  catch (const Failure &failure) { CHECK(failure.code == "E_UNSUPPORTED_OPTION"); }
  CHECK(!engine.pending("l2"));
  engine.run(plan("m", 2, Opacity, timingTo(0.5, 0.5)), 70, settled, touched);
  baked = engine.bake(2, Channel::Opacity, 70);
  CHECK(baked.lead && !baked.loop && baked.lead->samples.size() == 61 && baked.model[Opacity] == 0.5);
  CHECK(!engine.bake(2, Channel::Transform, 80).lead);

  // stopBatch, links and set().
  settled.clear();
  touched.clear();
  engine.stopBatch("j", 61.25, settled, touched);
  CHECK(settled.size() == 1 && !settled[0].finished && touched.size() == 1 && near(engine.state(1, Rotate, 62).value, 157.5, 1e-6));  // 90° → 360° spin, a quarter through its second cycle
  engine.link(2, TranslateX, true);
  try { engine.run(plan("n", 2, TranslateX, springTo(1)), 80, settled, touched); CHECK(false); }
  catch (const Failure &failure) { CHECK(failure.code == "E_BUSY"); }
  try { engine.set(2, {{TranslateX, 3}}, 80, settled); CHECK(false); }
  catch (const Failure &failure) { CHECK(failure.code == "E_BUSY"); }
  engine.setModel(2, TranslateX, 7);
  CHECK(engine.state(2, TranslateX, 80).value == 7);
  CHECK(interpolate({0, 100}, {1, 0}, 50, true) == 0.5 && interpolate({0, 100}, {1, 0}, 200, true) == 0 && interpolate({0, 100}, {1, 0}, 200, false) == -1);
  CHECK(interpolate({0, 50, 100}, {0, 10, 0}, 75, true) == 5);

  // Virtual clock: frozen time, explicit advance, and a shift when real time resumes.
  settled.clear();
  try { engine.advance(0.1); CHECK(false); } catch (const Failure &failure) { CHECK(failure.code == "E_UNAVAILABLE"); }
  engine.setVirtualClock(true, 100);
  engine.run(plan("v", 2, TranslateY, timingTo(40, 0.5)), engine.time(100.4), settled, touched);
  try { engine.advance(-1); CHECK(false); } catch (const Failure &failure) { CHECK(failure.code == "E_INVALID_ARGUMENT"); }
  settled.clear();
  engine.advance(0.25);
  CHECK(near(engine.state(2, TranslateY, engine.time(999)).value, 25, 1e-6));  // from 10 to 40
  CHECK(engine.setVirtualClock(false, 200) == 99.75);
  CHECK(near(engine.state(2, TranslateY, 200).value, 25, 1e-6) && near(*engine.nextCompletion(), 200.25, 1e-9));
  CHECK(near(engine.episode(2)->start, 100 + 99.75, 1e-9) && near(engine.episode(2)->end, 200.25, 1e-9));  // episodes shift with the clock
  engine.removeView(2, settled);
  CHECK(!engine.hasView(2) && settled.size() == 1 && !settled[0].finished && !engine.episode(2));

  // Episodes: a motion from rest to rest, with its history evaluable after the fact.
  Engine telemetry;
  telemetry.setTelemetry(true);
  telemetry.addView(5, kIdentity);
  CHECK(!telemetry.episode(5));
  telemetry.set(5, {{TranslateX, 10}}, 1, settled);  // at rest: no motion
  CHECK(!telemetry.episode(5));
  telemetry.run(plan("slide", 5, TranslateX, timingTo(110, 4, {0, 0, 1, 1})), 2, settled, touched);
  const Episode *slide = telemetry.episode(5);
  CHECK(slide && slide->start == 2 && slide->end == 6 && slide->startValues[TranslateX] == 10 && slide->kinds[TranslateX] == Spec::Kind::Timing && !slide->kinds[Opacity]);
  // An interruption at 25% inherits value and velocity: recorded with both states, and the planned end moves.
  telemetry.run(plan("spring", 5, TranslateX, springTo(60)), 3, settled, touched);
  CHECK(slide->interruptions.size() == 1 && slide->latest == 3 && slide->kinds[TranslateX] == Spec::Kind::Spring && slide->event == telemetry.events() && slide->event == 2);
  const Interruption &handoff = slide->interruptions[0];
  CHECK(handoff.property == TranslateX && near(handoff.before.value, 35, 1e-9) && near(handoff.before.velocity, 25, 1e-9));
  CHECK(near(handoff.after.value, handoff.before.value, 1e-9) && near(handoff.after.velocity, handoff.before.velocity, 1e-6));
  const double settles = slide->end;
  CHECK(settles > 3 && settles < 6);
  // The history answers for any instant: the slide before the interruption, the spring after it.
  CHECK(near(slide->at(TranslateX, 2.5).value, 22.5, 1e-9) && near(slide->at(TranslateX, 2.5).velocity, 25, 1e-9));
  CHECK(near(slide->at(TranslateX, 3).value, 35, 1e-9) && slide->at(TranslateX, settles + 1).value == 60 && slide->at(Opacity, 2.5).value == 1);
  // A second property starting mid-motion is not an interruption; ending naturally keeps the planned end.
  telemetry.run(plan("fade", 5, Opacity, timingTo(0, 0.1)), 3.05, settled, touched);
  CHECK(slide->interruptions.size() == 1 && near(slide->at(Opacity, 3.1).value, 0.5, 1e-9));
  telemetry.sweep(settles + 0.01, settled);
  CHECK(telemetry.episode(5) == slide && slide->end == settles && slide->at(Opacity, 10).value == 0);
  // Stopping a moving property is an interruption that ends the motion now (velocity drops to zero).
  telemetry.run(plan("again", 5, TranslateY, springTo(100)), 20, settled, touched);
  const Episode *stopped = telemetry.episode(5);
  CHECK(stopped->start == 20 && stopped->interruptions.empty());
  telemetry.stop(5, {TranslateY}, 20.1, settled);
  CHECK(stopped->end == 20.1 && stopped->interruptions.size() == 1 && stopped->interruptions[0].after.velocity == 0 && stopped->interruptions[0].before.velocity > 0);
  // Setting a value during a motion is a jump.
  telemetry.run(plan("jump", 5, Rotate, timingTo(90, 1)), 30, settled, touched);
  telemetry.set(5, {{Rotate, 0}}, 30.5, settled);
  CHECK(telemetry.episode(5)->interruptions.size() == 1 && telemetry.episode(5)->end == 30.5);


  // An animation that starts on a resting property while another moves is the motion's latest event (waitForMotion
  // sees it), and not an interruption, whether it starts at rest (a spring) or at full speed (linear).
  telemetry.run(plan("carrier", 5, TranslateX, timingTo(0, 10)), 40, settled, touched);
  const Episode *carried = telemetry.episode(5);
  const uint64_t started = carried->event;
  telemetry.run(plan("late spring", 5, ScaleX, springTo(2)), 41, settled, touched);
  CHECK(carried->event > started && carried->event == telemetry.events() && carried->latest == 41 && carried->interruptions.empty());
  CHECK(carried->kinds[ScaleX] == Spec::Kind::Spring && carried->segments[ScaleX].size() == 2);
  telemetry.run(plan("late linear", 5, ScaleY, timingTo(3, 1, {0, 0, 1, 1})), 42, settled, touched);
  CHECK(carried->event == telemetry.events() && carried->latest == 42 && carried->interruptions.empty());
  // Setting a resting property to another value during the motion is an interruption; setting it to its value is not.
  telemetry.set(5, {{Opacity, 0.5}}, 43, settled);
  CHECK(carried->interruptions.size() == 1 && carried->interruptions[0].property == Opacity && carried->interruptions[0].after.value == 0.5);
  telemetry.set(5, {{Opacity, 0.5}}, 43.5, settled);
  CHECK(carried->interruptions.size() == 1);
  // A sweep that settles a finished animation is neither.
  const uint64_t beforeSweep = telemetry.events();
  telemetry.sweep(43.6, settled);
  CHECK(telemetry.events() == beforeSweep);
  // Interruptions are capped; the episode says it is truncated.
  CHECK(!carried->truncated);
  for (size_t index = 0; index <= Episode::kMaxInterruptions; index++) telemetry.set(5, {{Rotate, double(index % 2 ? 0 : 1)}}, 44 + index * 1e-6, settled);
  CHECK(carried->interruptions.size() == Episode::kMaxInterruptions && carried->truncated);

  // Telemetry is off by default and records nothing; turning it off forgets every episode.
  Engine quiet;
  quiet.addView(1, kIdentity);
  quiet.run(plan("unrecorded", 1, Opacity, springTo(0)), 0, settled, touched);
  CHECK(!quiet.episode(1) && quiet.events() == 0);
  telemetry.setTelemetry(false);
  CHECK(!telemetry.episode(5));

  // Layout and shared-element hand-offs: each property starts from the given state and runs the transition to where it
  // was heading; the animation it replaces settles unfinished; scroll-linked and forever-repeating properties are left alone.
  {
    Engine layout;
    layout.setTelemetry(true);
    Values start = kIdentity;
    start[TranslateX] = 10;
    layout.addView(9, start);
    CHECK(layout.target(9, TranslateX) == 10.0);
    // A resting view whose layout moved 40 pt right shows where it was: it starts at -30 (its 10 minus 40) and springs back to 10.
    std::vector<Settled> handed;
    CHECK(layout.handoff(9, {{TranslateX, {-30, 0}}, {ScaleX, {0.5, 0}}}, springTo(0), 0, handed));
    CHECK(layout.state(9, TranslateX, 0).value == -30 && layout.state(9, ScaleX, 0).value == 0.5);
    CHECK(layout.target(9, TranslateX) == 10.0 && layout.target(9, ScaleX) == 1.0);
    CHECK(layout.animating(9, TranslateX, 0.1) && near(layout.state(9, TranslateX, 3).value, 10, 0.01));
    const Episode *moved = layout.episode(9);
    CHECK(moved && moved->kinds[TranslateX] == Spec::Kind::Spring && near(moved->at(TranslateX, 0).value, -30, 1e-9));
    // A second layout change mid-flight keeps the velocity it hands over and replaces only the properties it names.
    const State mid = layout.state(9, TranslateX, 0.1);
    CHECK(mid.velocity > 0);
    CHECK(layout.handoff(9, {{TranslateX, {mid.value - 20, mid.velocity}}}, timingTo(0, 0.3), 0.1, handed));
    CHECK(handed.empty() && layout.animating(9, ScaleX, 0.1));
    CHECK(near(layout.state(9, TranslateX, 0.1).value, mid.value - 20, 1e-9) && near(layout.state(9, TranslateX, 0.1).velocity, mid.velocity, 1e-6));
    CHECK(near(layout.state(9, TranslateX, 0.4).value, 10, 1e-9));
    // A timing transition from rest plays its own easing (no inherited velocity term).
    layout.sweep(1, handed);
    CHECK(layout.handoff(9, {{TranslateY, {-50, 0}}}, timingTo(0, 0.2, {0, 0, 1, 1}), 1, handed));
    CHECK(near(layout.state(9, TranslateY, 1.1).value, -25, 1e-9));
    // An animation's target survives a hand-off on its property: it ends where the animation was going.
    std::vector<int64_t> touched2;
    layout.run(plan("slide", 9, TranslateX, timingTo(100, 1)), 2, handed, touched2);
    CHECK(layout.handoff(9, {{TranslateX, {layout.state(9, TranslateX, 2.5).value - 5, layout.state(9, TranslateX, 2.5).velocity}}}, springTo(0), 2.5, handed));
    CHECK(handed.back().id == "slide" && !handed.back().finished);
    CHECK(near(layout.state(9, TranslateX, 6).value, 100, 0.01));
    // Scroll-linked and forever-repeating properties keep their motion; with nothing to hand off, nothing runs.
    layout.link(9, Rotate, true);
    Spec forever = timingTo(1.2, 0.5);
    forever.repeat = std::numeric_limits<double>::infinity();
    layout.run(plan("pulse", 9, ScaleY, forever), 7, handed, touched2);
    CHECK(!layout.target(9, ScaleY));
    CHECK(!layout.handoff(9, {{Rotate, {5, 0}}, {ScaleY, {2, 0}}}, springTo(0), 7.1, handed));
    CHECK(layout.state(9, Rotate, 7.1).value == 0 && layout.animating(9, ScaleY, 7.1));
    Spec bad = springTo(0);
    bad.from = State{std::nan(""), 0};
    bool rejected = false;
    try { layout.run(plan("bad from", 9, Opacity, bad), 8, handed, touched2); } catch (const Failure &failure) { rejected = failure.code == "E_INVALID_ARGUMENT"; }
    CHECK(rejected);
  // Reduce Motion, fade (the default alternate): transforms change at once, opacity fades 200 ms without bounce, and a
  // step that only moves fades in where it lands. The plan as written still reports its own end, for cue times.
  {
    Engine reduce;
    std::vector<Settled> done;
    std::vector<int64_t> views;
    reduce.addView(1, kIdentity);
    Plan slide = plan("slide", 1, TranslateX, springTo(100, 0.5, 0.3));
    slide.reduceMotion = true;
    const Started started = reduce.run(slide, 0, done, views);
    CHECK(started.reduced && near(started.end, kReducedFade, 1e-9) && started.plannedEnd > 0.5);
    CHECK(reduce.state(1, TranslateX, 0).value == 100 && reduce.state(1, Opacity, 0).value == 0);
    CHECK(near(reduce.state(1, Opacity, kReducedFade / 2).value, 0.5, 1e-6) && reduce.state(1, Opacity, kReducedFade).value == 1);
    CHECK(reduce.track(1, TranslateX)->first->kind == Spec::Kind::Jump && reduce.track(1, Opacity)->first->kind == Spec::Kind::Timing);
    reduce.sweep(kReducedFade, done);
    CHECK(done.size() == 1 && done[0].id == "slide" && done[0].finished);
    // An entrance: opacity fades to its target with no overshoot; the transform is already there.
    reduce.set(1, {{Opacity, 0}}, 1, done);
    Plan entrance{"entrance", {{1, {{Opacity, springTo(0.4, 0.5, 0.3)}, {TranslateY, springTo(-20, 0.5, 0.3)}}, false, 0}}, true};
    reduce.run(entrance, 1, done, views);
    CHECK(reduce.state(1, TranslateY, 1).value == -20 && reduce.state(1, Opacity, 1 + kReducedFade).value == 0.4);
    for (double t = 1; t <= 1 + kReducedFade; t += 0.01) CHECK(reduce.state(1, Opacity, t).value >= -1e-9 && reduce.state(1, Opacity, t).value <= 0.4 + 1e-9);
    // An exit keeps its place until it has faded out.
    Plan exit{"exit", {{1, {{Opacity, timingTo(0, 0.3)}, {TranslateY, timingTo(40, 0.3)}}, false, 0}}, true};
    reduce.run(exit, 2, done, views);
    CHECK(reduce.state(1, TranslateY, 2 + kReducedFade / 2).value == -20 && reduce.state(1, TranslateY, 2 + kReducedFade).value == 40);
    // A loop holds where it is and settles; a step's own alternate replaces it; Play keeps the plan; Instant jumps.
    Spec spin = timingTo(360, 1);
    spin.repeat = INFINITY;
    Plan loop = plan("loop", 1, Rotate, spin);
    loop.reduceMotion = true;
    CHECK(std::isfinite(reduce.run(loop, 3, done, views).end) && reduce.state(1, Rotate, 3.5).value == 0);
    Plan own = plan("own", 1, TranslateX, springTo(0));
    own.reduceMotion = true;
    own.groups[0].reduced = Tracks{{Opacity, timingTo(0.5, 0.1)}};
    reduce.run(own, 4, done, views);
    CHECK(reduce.state(1, TranslateX, 4.5).value == 100 && reduce.state(1, Opacity, 4.1).value == 0.5);
    Plan play = plan("play", 1, TranslateX, timingTo(0, 1));
    play.reduceMotion = true;
    play.reduce = Reduce::Play;
    CHECK(!reduce.run(play, 5, done, views).reduced && near(reduce.state(1, TranslateX, 5.5).value, 50, 1e-6));
    Plan instant{"instant", {{1, {{Opacity, timingTo(1, 1)}, {TranslateX, timingTo(30, 1)}}, false, 0.5}}, true, Reduce::Instant};
    const Started jumped = reduce.run(instant, 7, done, views);
    CHECK(near(jumped.end, 0.5, 1e-9) && near(jumped.plannedEnd, 1.5, 1e-9));
    CHECK(reduce.state(1, Opacity, 7.4).value == 0.5 && reduce.state(1, Opacity, 7.5).value == 1 && reduce.state(1, TranslateX, 7.5).value == 30);
    // Cues: at a time or at the end; under Reduce Motion their times scale with the alternate (here the 200 ms fade-in).
    Plan cued = plan("cued", 1, TranslateX, timingTo(60, 1));
    cued.cues = {0.5, std::nullopt};
    Started timed = reduce.run(cued, 7.5, done, views);
    CHECK(timed.cues.size() == 2 && timed.cues[0] == 0.5 && timed.cues[1] == 1);
    cued.id = "cued reduced";
    cued.reduceMotion = true;
    timed = reduce.run(cued, 7.6, done, views);
    CHECK(timed.reduced && timed.cues.size() == 2 && near(timed.cues[0], kReducedFade / 2, 1e-12) && near(timed.cues[1], kReducedFade, 1e-12));
    Plan late = plan("late cue", 1, TranslateX, timingTo(0, 1));
    late.cues = {1.5};
    try { reduce.run(late, 7.7, done, views); CHECK(false); } catch (const Failure &failure) { CHECK(failure.code == "E_INVALID_ARGUMENT" && !reduce.pending("late cue")); }
    Plan endless = plan("endless", 1, Rotate, spin);
    endless.cues = {std::nullopt};
    try { reduce.run(endless, 7.7, done, views); CHECK(false); } catch (const Failure &failure) { CHECK(failure.code == "E_UNSUPPORTED_OPTION" && !reduce.pending("endless")); }
    // Without Reduce Motion the plan plays as written.
    Plan written = plan("written", 1, TranslateX, timingTo(0, 1));
    const Started normal = reduce.run(written, 8, done, views);
    CHECK(!normal.reduced && normal.end == 1 && normal.plannedEnd == 1 && near(reduce.state(1, TranslateX, 8.5).value, 30, 1e-6));
  }

  // Hidden views: finite animations jump to their end and finish; loops (and plans that pause) freeze and resume
  // exactly where they were; what starts while hidden follows the same rule.
  {
    Engine hide;
    hide.setTelemetry(true);
    std::vector<Settled> done;
    std::vector<int64_t> views;
    hide.addView(1, kIdentity);
    hide.addView(2, kIdentity);
    hide.run(plan("finite", 1, TranslateX, timingTo(100, 1)), 0, done, views);
    Spec spin = timingTo(360, 1, {0, 0, 1, 1});
    spin.repeat = INFINITY;
    hide.run(plan("spin", 1, Rotate, spin), 0, done, views);
    Plan held = plan("held", 2, TranslateY, timingTo(10, 1, {0, 0, 1, 1}));
    held.pauseWhenHidden = true;
    hide.run(held, 0, done, views);
    done.clear();
    hide.setHidden(1, true, 0.25, done);
    hide.setHidden(2, true, 0.25, done);
    CHECK(done.size() == 1 && done[0].id == "finite" && done[0].finished);
    CHECK(hide.paused(1) && hide.paused(2) && hide.state(1, TranslateX, 0.25).value == 100);
    CHECK(near(hide.state(1, Rotate, 5).value, 90, 1e-6) && near(hide.state(2, TranslateY, 5).value, 2.5, 1e-9));
    CHECK(hide.animating(2, TranslateY, 5) && !hide.nextCompletion());
    const ChannelBake frozen = hide.bake(1, Channel::Transform, 5);
    CHECK(!frozen.lead && !frozen.loop && near(frozen.model[Rotate], 90, 1e-6));
    done.clear();
    hide.sweep(5.5, done);
    CHECK(done.empty());
    // Starting an animation on a hidden view: a finite one finishes at once, a loop starts paused.
    hide.run(plan("while hidden", 1, Opacity, timingTo(0.2, 1)), 6, done, views);
    CHECK(done.size() == 1 && done[0].id == "while hidden" && done[0].finished && near(hide.state(1, Opacity, 6).value, 0.2, 1e-12));
    CHECK(hide.paused(1) && near(hide.state(1, Rotate, 6).value, 90, 1e-6));
    // That operation resumed view 1 for its duration: its tracks moved by the 5.75 s it had been paused, and the caller
    // learns it (cues timed by those tracks move with them). View 2 has not resumed.
    const auto shifts = hide.takeResumeShifts();
    CHECK(shifts.size() == 1 && near(shifts.at(1), 5.75, 1e-9) && hide.takeResumeShifts().empty());
    // Shown again 10 s after hiding: the loop and the paused plan resume where they were. View 1 was last paused by the
    // operation at 6 s, so its last paused interval is 4.25 s.
    CHECK(near(hide.setHidden(1, false, 10.25, done), 4.25, 1e-9) && near(hide.setHidden(2, false, 10.25, done), 10, 1e-9));
    CHECK(!hide.paused(1) && near(hide.state(1, Rotate, 10.5).value, 180, 1e-6) && near(hide.state(2, TranslateY, 10.5).value, 5, 1e-9));
    const auto shown = hide.takeResumeShifts();
    CHECK(shown.size() == 2 && near(shown.at(1), 4.25, 1e-9) && near(shown.at(2), 10, 1e-9));
    CHECK(near(*hide.nextCompletion(), 11, 1e-9));
    done.clear();
    hide.sweep(11, done);
    CHECK(done.size() == 1 && done[0].id == "held" && done[0].finished);
    // A virtual clock shift keeps a paused view frozen at the same instant.
    const double rotation = hide.state(1, Rotate, 11.2).value;
    hide.setHidden(1, true, 11.2, done);
    hide.setVirtualClock(true, 11.2);
    hide.advance(5);
    hide.setVirtualClock(false, 30);
    CHECK(near(rotation, 72, 1e-6) && near(hide.state(1, Rotate, 40).value, rotation, 1e-9));
    // stop() on a hidden view freezes its loop and leaves nothing paused.
    hide.stop(1, {Rotate}, 41, done);
    CHECK(!hide.paused(1) && !hide.animating(1, Rotate, 41) && near(hide.state(1, Rotate, 41).value, rotation, 1e-9));
    // Bakes sample at the display's rate: 60 Hz gives half the samples of 120 Hz for the same duration.
    hide.setHidden(1, false, 42, done);
    hide.run(plan("rate", 1, TranslateX, timingTo(0, 1)), 42, done, views);
    CHECK(hide.bake(1, Channel::Transform, 42, 60).lead->samples.size() == 61 && hide.bake(1, Channel::Transform, 42).lead->samples.size() == 121);
    CHECK(hide.bake(1, Channel::Transform, 42, 240).lead->samples.size() == 121);
    try { hide.setHidden(99, true, 0, done); CHECK(false); } catch (const Failure &failure) { CHECK(failure.code == "E_NOT_FOUND"); }
  }

  if (failures) { std::printf("%d motion engine checks failed\n", failures); return 1; }
  std::puts("Motion engine tests passed");
}
