import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("Windows Nitro uses RNW's runtime-supplied initializer and retains installation errors", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-windows-nitro-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const rnw = readFileSync(path.join(root, "node_modules/react-native-windows/Microsoft.ReactNative.Cxx/NativeModules.h"), "utf8").replaceAll("\r\n", "\n");
    const start = rnw.indexOf("template <class TMethod>\nstruct ModuleJsiInitMethodInfo;");
    const end = rnw.indexOf("// ==== MakeCallbackSignatures", start);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    const initializer = rnw.slice(start, end);
    writeFileSync(path.join(directory, "NativeModules.h"), `#pragma once
#include <memory>
#include <string>
#include <functional>
#define REACT_MODULE(...)
#define REACT_INIT(...)
#define REACT_SYNC_METHOD(...)
namespace facebook::jsi { struct Runtime { int identity; }; }
namespace winrt {
  struct hresult_error { std::string message() const { return "Windows failure"; } };
  inline std::string to_string(std::string const &value) { return value; }
  namespace Windows::Foundation { struct IInspectable { facebook::jsi::Runtime *runtime; explicit operator bool() const { return runtime != nullptr; } }; }
  namespace Microsoft::ReactNative {
    struct ReactDispatcher { int identity; };
    struct ReactContext {
      int identity;
      ReactDispatcher UIDispatcher() const { return {identity}; }
      std::shared_ptr<int> CallInvoker() const { return std::make_shared<int>(identity); }
    };
    using JsiInitializerDelegate = std::function<void(ReactContext const &, winrt::Windows::Foundation::IInspectable const &)>;
    inline facebook::jsi::Runtime &GetOrCreateContextRuntime(ReactContext const &, winrt::Windows::Foundation::IInspectable const &handle) { return *handle.runtime; }
    ${initializer}
  }
}
`);
    writeFileSync(path.join(directory, "CallInvokerDispatcher.hpp"), `#pragma once
#include <memory>
namespace margelo::nitro { struct CallInvokerDispatcher { std::shared_ptr<int> invoker; explicit CallInvokerDispatcher(std::shared_ptr<int> value) : invoker(value) {} }; }
`);
    writeFileSync(path.join(directory, "InstallNitro.hpp"), `#pragma once
#include "NativeModules.h"
#include "CallInvokerDispatcher.hpp"
namespace margelo::nitro { void install(facebook::jsi::Runtime &, std::shared_ptr<CallInvokerDispatcher>); }
`);
    const input = path.join(directory, "test.cpp"), output = path.join(directory, "test");
    const header = path.join(root, "patches/windows/nitro/windows/SparkNitro/SparkNitro.h");
    writeFileSync(input, `#include "${header}"
#include <cassert>
#include <stdexcept>
#include <cstdio>
static int calls = 0, failure = 0, dispatcher = 0;
static facebook::jsi::Runtime *installed = nullptr;
namespace margelo::nitro {
void SetWindowsUIDispatcher(winrt::Microsoft::ReactNative::ReactDispatcher const &value) { dispatcher = value.identity; }
void install(facebook::jsi::Runtime &runtime, std::shared_ptr<CallInvokerDispatcher> callback) {
  ++calls; assert(callback && *callback->invoker == dispatcher);
  if (failure == 1) throw std::runtime_error("Native failure");
  if (failure == 2) throw winrt::hresult_error{};
  installed = &runtime;
}
}
static void Initialize(SparkNitroModule &module, facebook::jsi::Runtime *runtime, int identity) {
  auto initialize = winrt::Microsoft::ReactNative::ModuleJsiInitMethodInfo<decltype(&SparkNitroModule::Initialize)>::GetJsiInitializer(&module, &SparkNitroModule::Initialize);
  initialize({identity}, {runtime});
}
int main() {
  SparkNitroModule module;
  assert(module.install().has_value());
  Initialize(module, nullptr, 1); assert(calls == 0 && module.install().has_value());
  facebook::jsi::Runtime first{1}; Initialize(module, &first, 1);
  assert(calls == 1 && installed == &first && !module.install().has_value());
  module.install(); assert(calls == 1);
  failure = 1; SparkNitroModule failed; Initialize(failed, &first, 1);
  assert(failed.install() == "Native failure");
  failure = 2; SparkNitroModule windowsFailure; Initialize(windowsFailure, &first, 1);
  assert(windowsFailure.install() == "Windows failure");
  failure = 0; SparkNitroModule reloaded; facebook::jsi::Runtime second{2}; Initialize(reloaded, &second, 2);
  assert(installed == &second && !reloaded.install().has_value());
  puts("Windows Nitro initializer passed");
}
`);
    execFileSync("clang++", ["-std=c++20", "-I", directory, input, "-o", output]);
    expect(execFileSync(output, { encoding: "utf8", timeout: 10000 })).toContain("Windows Nitro initializer passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
