#include <hermes/hermes.h>
#include <jsi/jsi.h>
#include <ReactCommon/CallInvoker.h>
#include <chrono>
#include <condition_variable>
#include <fstream>
#include <iostream>
#include <mutex>
#include <queue>
#include <sstream>
#include <thread>
#ifdef NITRO_BACKEND
#include <NitroModules/InstallNitro.hpp>
#include <NitroModules/HybridObjectRegistry.hpp>
#include "HybridNitroSQLite.hpp"
#endif
#ifdef OP_BACKEND
#include "OPSqlite.hpp"
#endif
using namespace facebook;
using Clock = std::chrono::steady_clock;
class Loop {
 public:
  struct Task { Clock::time_point due; std::function<void()> fn; bool operator<(const Task& b) const { return due > b.due; } };
  std::mutex mutex; std::condition_variable cv; std::priority_queue<Task> tasks;
  void post(std::function<void()> fn, double delay=0) { std::lock_guard lock(mutex); tasks.push({Clock::now()+std::chrono::microseconds((long long)(delay*1000)),std::move(fn)}); cv.notify_one(); }
  void once() { std::function<void()> fn; { std::unique_lock lock(mutex); if(tasks.empty()) cv.wait_for(lock,std::chrono::milliseconds(10)); if(tasks.empty()) return; if(tasks.top().due > Clock::now()) { cv.wait_until(lock,tasks.top().due); return; } fn=tasks.top().fn; tasks.pop(); } fn(); }
};
class Invoker : public react::CallInvoker {
 Loop& loop; jsi::Runtime& runtime;
 public: Invoker(Loop& l, jsi::Runtime& r):loop(l),runtime(r){}
 void invokeAsync(react::CallFunc&& fn) noexcept override { loop.post([this,fn=std::move(fn)] {fn(runtime);}); }
 void invokeSync(react::CallFunc&& fn) override { fn(runtime); }
};
#ifdef NITRO_BACKEND
class BenchmarkDispatcher : public margelo::nitro::Dispatcher {
 Loop& loop;
 public: BenchmarkDispatcher(Loop& l):loop(l){} void runSync(std::function<void()>&& fn) override {fn();} void runAsync(std::function<void()>&& fn) override {loop.post(std::move(fn));}
};
#endif
int main(int argc,char**argv) {
 try {
  if(argc!=3) throw std::runtime_error("usage: host script.js database-directory");
  Loop loop;
  auto runtime=facebook::hermes::makeHermesRuntime(::hermes::vm::RuntimeConfig::Builder().withMicrotaskQueue(true).build());
  auto& rt=*runtime; rt.global().setProperty(rt,"global",rt.global()); const auto start=Clock::now();
  auto bind=[&](const char*name,unsigned n,jsi::HostFunctionType fn) { rt.global().setProperty(rt,name,jsi::Function::createFromHostFunction(rt,jsi::PropNameID::forAscii(rt,name),n,std::move(fn))); };
  bind("__now",0,[&](jsi::Runtime&,const jsi::Value&,const jsi::Value*,size_t){return jsi::Value(std::chrono::duration<double,std::milli>(Clock::now()-start).count());});
  bind("__print",1,[](jsi::Runtime&r,const jsi::Value&,const jsi::Value*a,size_t){std::cout<<a[0].asString(r).utf8(r)<<std::endl;return jsi::Value::undefined();});
  bind("setTimeout",2,[&](jsi::Runtime&r,const jsi::Value&,const jsi::Value*a,size_t count){auto fn=std::make_shared<jsi::Function>(a[0].asObject(r).asFunction(r));loop.post([&rt,fn]{fn->call(rt);},count>1?a[1].asNumber():0);return jsi::Value(1);});
  rt.global().setProperty(rt,"__benchmarkDone",false);
  rt.global().setProperty(rt,"__dbDirectory",jsi::String::createFromUtf8(rt,argv[2]));
#ifdef OP_BACKEND
  auto invoker=std::make_shared<Invoker>(loop,rt); auto generation=opsqlite::install(rt,invoker,argv[2],"");
  rt.global().setProperty(rt,"__provider",jsi::String::createFromAscii(rt,"op"));
#endif
#ifdef NITRO_BACKEND
  using namespace margelo::nitro; using namespace margelo::nitro::rnnitrosqlite;
  HybridNitroSQLite::docPath=argv[2];
  HybridObjectRegistry::registerHybridObjectConstructor("NitroSQLite",[]{return std::make_shared<HybridNitroSQLite>();});
  auto dispatcher=std::make_shared<BenchmarkDispatcher>(loop); install(rt,dispatcher);
  rt.global().setProperty(rt,"__provider",jsi::String::createFromAscii(rt,"nitro"));
#endif
  std::ifstream input(argv[1]); std::stringstream buffer; buffer<<input.rdbuf();
  rt.evaluateJavaScript(std::make_shared<jsi::StringBuffer>(buffer.str()),argv[1]); rt.drainMicrotasks();
  while(!rt.global().getProperty(rt,"__benchmarkDone").getBool()) {
    if(Clock::now()-start>std::chrono::minutes(10)) throw std::runtime_error("benchmark timeout");
    loop.once(); rt.drainMicrotasks();
  }
  bool failed=rt.global().getProperty(rt,"__benchmarkFailed").getBool();
#ifdef OP_BACKEND
  opsqlite::invalidate(generation);
#endif
  return failed?1:0;
 } catch(const std::exception&e) { std::cerr<<e.what()<<std::endl;return 1; }
}
