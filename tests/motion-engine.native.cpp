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

  if (failures) { std::printf("%d motion engine checks failed\n", failures); return 1; }
  std::puts("Motion engine tests passed");
}
