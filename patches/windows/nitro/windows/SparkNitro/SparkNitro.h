#pragma once
#include "NativeModules.h"
#include <InstallNitro.hpp>
#include <CallInvokerDispatcher.hpp>
#include <optional>
namespace margelo::nitro { void SetWindowsUIDispatcher(winrt::Microsoft::ReactNative::ReactDispatcher const &); }
REACT_MODULE(SparkNitroModule, L"NitroModules")
struct SparkNitroModule {
  std::optional<std::string> installError = "The Windows Nitro JSI initializer did not run";
  REACT_INIT(Initialize) void Initialize(winrt::Microsoft::ReactNative::ReactContext const &context, facebook::jsi::Runtime &runtime) noexcept {
    try {
      margelo::nitro::SetWindowsUIDispatcher(context.UIDispatcher());
      margelo::nitro::install(runtime, std::make_shared<margelo::nitro::CallInvokerDispatcher>(context.CallInvoker()));
      installError.reset();
    } catch (std::exception const &error) { installError = error.what(); }
    catch (winrt::hresult_error const &error) { installError = winrt::to_string(error.message()); }
  }
  REACT_SYNC_METHOD(install) std::optional<std::string> install() noexcept { return installError; }
};
