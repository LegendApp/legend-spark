#pragma once
#ifdef __cplusplus
#include <jsi/jsi.h>
#include <ReactCommon/CallInvoker.h>
#include <react/bridging/CallbackWrapper.h>
#include <atomic>
#include <functional>
#include <cstring>
#include <cmath>
#include <optional>
#include <map>
#include <vector>

namespace spark::binary {
namespace jsi = facebook::jsi;
using Builder = std::function<jsi::Value(jsi::Runtime &)>;
using Completion = std::function<void(Builder, std::string, std::string)>;
using Start = std::function<void(std::string, std::string, std::optional<std::vector<uint8_t>>, Completion)>;

class Bytes final : public jsi::MutableBuffer {
public:
  explicit Bytes(std::vector<uint8_t> value) : value_(std::move(value)) { if (value_.empty()) value_.reserve(1); }
  size_t size() const override { return value_.size(); }
  uint8_t *data() override { return value_.data(); }
private:
  std::vector<uint8_t> value_;
};
inline jsi::Value Buffer(jsi::Runtime &rt, std::shared_ptr<jsi::MutableBuffer> const &bytes) { return jsi::ArrayBuffer(rt, bytes); }
inline Builder JSON(std::string value) {
  return [value = std::move(value)](jsi::Runtime &rt) { auto json = rt.global().getPropertyAsObject(rt, "JSON"); return json.getPropertyAsFunction(rt, "parse").callWithThis(rt, json, jsi::String::createFromUtf8(rt, value)); };
}
struct Response {
  std::string json = "null";
  std::shared_ptr<jsi::MutableBuffer> bytes;
  std::map<std::string, std::shared_ptr<jsi::MutableBuffer>> fields;
  Builder Build() const {
    return [value = *this](jsi::Runtime &rt) {
      if (value.bytes) return Buffer(rt, value.bytes);
      auto result = JSON(value.json)(rt);
      if (!value.fields.empty()) { auto object = result.asObject(rt); for (auto const &[key, bytes] : value.fields) object.setProperty(rt, key.c_str(), Buffer(rt, bytes)); return jsi::Value(std::move(object)); }
      return result;
    };
  }
};
// Uses React's runtime-owned callbacks; pending native work never retains a JS
// function after runtime teardown. Only the invoker accesses the owning runtime.
inline jsi::Value Promise(jsi::Runtime &rt, std::shared_ptr<facebook::react::CallInvoker> invoker, std::function<void(Completion)> start) {
  auto executor = jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, "executor"), 2,
    [invoker, start = std::move(start)](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t) {
      auto resolve = facebook::react::CallbackWrapper::createWeak(args[0].asObject(rt).asFunction(rt), rt, invoker);
      auto reject = facebook::react::CallbackWrapper::createWeak(args[1].asObject(rt).asFunction(rt), rt, invoker);
      auto settled = std::make_shared<std::atomic<bool>>(false);
      Completion finish = [resolve, reject, invoker, settled](Builder build, std::string code, std::string message) {
        if (settled->exchange(true)) return;
        invoker->invokeAsync([resolve, reject, build = std::move(build), code = std::move(code), message = std::move(message)](jsi::Runtime &rt) {
          auto good = resolve.lock(), bad = reject.lock(); if (!good || !bad) return;
          if (code.empty()) good->callback().call(rt, build(rt));
          else { auto error = rt.global().getPropertyAsFunction(rt, "Error").callAsConstructor(rt, jsi::String::createFromUtf8(rt, message)).asObject(rt); error.setProperty(rt, "code", jsi::String::createFromUtf8(rt, code)); bad->callback().call(rt, error); }
          good->destroy(); bad->destroy();
        });
      };
      try { start(finish); } catch (std::exception const &error) { finish({}, "E_NATIVE", error.what()); }
      return jsi::Value::undefined();
    });
  return rt.global().getPropertyAsFunction(rt, "Promise").callAsConstructor(rt, executor);
}
inline jsi::Function Function(jsi::Runtime &rt, std::shared_ptr<facebook::react::CallInvoker> invoker, Start start) {
  return jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, "binaryCall"), 5,
    [invoker, start = std::move(start)](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
      if (count < 2) throw jsi::JSError(rt, "Expected a binary operation and arguments");
      auto method = args[0].asString(rt).utf8(rt), json = args[1].asString(rt).utf8(rt);
      std::optional<std::vector<uint8_t>> bytes;
      if (count > 2 && !args[2].isUndefined()) {
        if (count < 5) throw jsi::JSError(rt, "Expected a binary buffer offset and length");
        auto buffer = args[2].asObject(rt).getArrayBuffer(rt); auto offset = args[3].asNumber(), length = args[4].asNumber();
        if (!std::isfinite(offset) || !std::isfinite(length) || offset < 0 || length < 0 || std::floor(offset) != offset || std::floor(length) != length || offset + length > buffer.size(rt)) throw jsi::JSError(rt, "Invalid binary buffer range");
        // Snapshot once, before returning to JS. Never touch borrowed JS bytes on
        // an I/O worker; views retain their exact offset and length.
        bytes.emplace(static_cast<size_t>(length)); if (length) memcpy(bytes->data(), buffer.data(rt) + static_cast<size_t>(offset), static_cast<size_t>(length));
      }
      return Promise(rt, invoker, [start, method = std::move(method), json = std::move(json), bytes = std::move(bytes)](Completion finish) mutable { start(std::move(method), std::move(json), std::move(bytes), std::move(finish)); });
    });
}
inline void Emit(std::shared_ptr<facebook::react::CallInvoker> invoker, Builder build, std::function<void()> delivered = {}) {
  invoker->invokeAsync([build = std::move(build), delivered = std::move(delivered)](jsi::Runtime &rt) { struct Ack { std::function<void()> done; ~Ack() { if (done) done(); } } ack{delivered}; if (rt.global().getProperty(rt, "__rctDeviceEventEmitter").isUndefined()) return; auto emitter = rt.global().getPropertyAsObject(rt, "__rctDeviceEventEmitter"); emitter.getPropertyAsFunction(rt, "emit").callWithThis(rt, emitter, "desktop", build(rt)); });
}
}

#endif
