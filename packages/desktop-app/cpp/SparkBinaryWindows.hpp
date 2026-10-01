#pragma once
#ifdef _WIN32
#include "SparkBinaryJSI.hpp"
#include <JSI/JsiApiContext.h>
namespace spark::binary {
struct NativePromise {
  std::function<void(Response)> resolve;
  std::function<void(winrt::Microsoft::ReactNative::ReactError)> reject;
  void Resolve(std::string json) const { resolve(Response{std::move(json), {}, {}}); }
  void Resolve(Response value) const { resolve(std::move(value)); }
  void Reject(winrt::Microsoft::ReactNative::ReactError value) const { reject(std::move(value)); }
  NativePromise(Completion finish) : resolve([finish](Response value) { finish(value.Build(), {}, {}); }), reject([finish](auto error) { finish({}, error.Code, error.Message); }) {}
  NativePromise(winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) : resolve([promise](Response value) { promise.Resolve(value.json); }), reject([promise](auto error) { promise.Reject(error); }) {}
};
inline void Install(winrt::Microsoft::ReactNative::ReactContext context, const char *name, Start start) {
  auto handle = context.Handle().JSRuntime(); if (!handle) throw std::runtime_error("The Windows runtime does not expose JSI");
  auto &runtime = winrt::Microsoft::ReactNative::GetOrCreateContextRuntime(context, handle);
  runtime.global().setProperty(runtime, name, Function(runtime, context.CallInvoker(), std::move(start)));
}
}

#endif
