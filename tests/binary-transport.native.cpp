#include <hermes/hermes.h>
#include "../packages/desktop-app/cpp/SparkBinaryJSI.hpp"
#include <deque>
#include <iostream>
#include <chrono>
using namespace facebook;
class Invoker final : public react::CallInvoker {
public:
  std::deque<react::CallFunc> pending;
  void invokeAsync(react::CallFunc &&fn) noexcept override { pending.push_back(std::move(fn)); }
  void invokeSync(react::CallFunc &&) override { throw std::runtime_error("Unexpected synchronous invoke"); }
};
int main() {
  auto runtime = facebook::hermes::makeHermesRuntime(::hermes::vm::RuntimeConfig::Builder().withMicrotaskQueue(true).build()); auto &rt = *runtime; auto invoker = std::make_shared<Invoker>();
  std::shared_ptr<spark::binary::Bytes> latest; spark::binary::Completion held;
  rt.global().setProperty(rt,"binary",spark::binary::Function(rt,invoker,[&](std::string method,std::string,std::optional<std::vector<uint8_t>> input,spark::binary::Completion done) {
    if(method=="reject") { done({},"E_PERMISSION","denied"); return; }
    if(method=="pending") { held=done; return; }
    if(method=="write") { if(!input||input->size()!=1048576||input->front()!=231||input->back()!=231) throw std::runtime_error("Input snapshot incorrect"); done(spark::binary::JSON("null"),{},{}); return; }
    latest=std::make_shared<spark::binary::Bytes>(method=="read"?std::vector<uint8_t>(1048576,231):std::move(*input));
    done([bytes=latest](jsi::Runtime &rt) { return spark::binary::Buffer(rt,bytes); },{},{});
  }));
  rt.global().setProperty(rt,"same",jsi::Function::createFromHostFunction(rt,jsi::PropNameID::forAscii(rt,"same"),1,[&](jsi::Runtime &rt,const jsi::Value &,const jsi::Value *args,size_t)->jsi::Value { auto buffer=args[0].asObject(rt).getArrayBuffer(rt); return jsi::Value(buffer.data(rt)==latest->data()); }));
  rt.global().setProperty(rt,"release",jsi::Function::createFromHostFunction(rt,jsi::PropNameID::forAscii(rt,"release"),0,[&](jsi::Runtime &,const jsi::Value &,const jsi::Value *,size_t)->jsi::Value { latest.reset(); return jsi::Value::undefined(); }));
  rt.global().setProperty(rt,"now",jsi::Function::createFromHostFunction(rt,jsi::PropNameID::forAscii(rt,"now"),0,[](jsi::Runtime &,const jsi::Value &,const jsi::Value *,size_t)->jsi::Value { return jsi::Value(std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count()); }));
  bool finished=false;
  rt.global().setProperty(rt,"complete",jsi::Function::createFromHostFunction(rt,jsi::PropNameID::forAscii(rt,"complete"),1,[&](jsi::Runtime &rt,const jsi::Value &,const jsi::Value *args,size_t)->jsi::Value { std::cout<<args[0].asString(rt).utf8(rt)<<std::endl;finished=true;return jsi::Value::undefined(); }));
  std::string source=R"JS((function(){
    const check=(value)=>{if(!value)throw Error('Buffer check failed')};
    const data=new Uint8Array([9,0,255,1,9]), pending=binary('roundtrip','{}',data.buffer,1,3); data.fill(0);
    pending.then(buffer=>{check(same(buffer));const bytes=new Uint8Array(buffer);check(bytes.length===3&&bytes[0]===0&&bytes[1]===255&&bytes[2]===1);bytes[1]=128;release();check(new Uint8Array(buffer)[1]===128);return binary('empty','{}',new ArrayBuffer(0),0,0)})
      .then(empty=>{check(empty.byteLength===0&&same(empty));return binary('reject','{}').then(()=>{throw Error('Missing rejection')},error=>check(error.code==='E_PERMISSION'&&error.message==='denied'))})
      .then(()=>{try{binary('bad','{}',new ArrayBuffer(1));throw Error('Missing argument error')}catch(error){check(error.message.includes('offset'))}try{binary('bad','{}',new ArrayBuffer(1),2,1);throw Error('Missing range error')}catch(error){check(error.message.includes('range'))}
        const input=new Uint8Array(1048576);input.fill(231);const read=[],write=[];
        function sample(n){let start=now();return binary('read','{}').then(out=>{check(same(out)&&out.byteLength===input.length);if(n>=3)read.push(now()-start);start=now();return binary('write','{}',input.buffer,0,input.length)}).then(()=>{if(n>=3)write.push(now()-start);if(n<29)return sample(n+1);complete(JSON.stringify({checksPassed:true,readMs:read,writeMs:write}))})}
        return sample(0);
      }).catch(error=>complete(JSON.stringify({failed:String(error)})));
  })())JS";
  rt.evaluateJavaScript(std::make_shared<jsi::StringBuffer>(source),"binary-test.js");
  while(!finished){while(!invoker->pending.empty()){auto fn=std::move(invoker->pending.front());invoker->pending.pop_front();fn(rt);}rt.drainMicrotasks();}
  if (react::LongLivedObjectCollection::get(rt).size() != 0) throw std::runtime_error("Settled callbacks leaked");
  rt.evaluateJavaScript(std::make_shared<jsi::StringBuffer>("binary('pending','{}')"),"teardown.js");
  if (react::LongLivedObjectCollection::get(rt).size() != 2) throw std::runtime_error("Pending callback ownership incorrect");
  react::LongLivedObjectCollection::get(rt).clear();held(spark::binary::JSON("null"),{},{});
  while(!invoker->pending.empty()){auto fn=std::move(invoker->pending.front());invoker->pending.pop_front();fn(rt);}
  return 0;
}
