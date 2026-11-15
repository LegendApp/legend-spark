#include "pch.h"
#include <ReactDispatcher.h>
#include <ThreadUtils.hpp>
#include <NitroLogger.hpp>
#include <future>
#include <mutex>
#include <winrt/Microsoft.UI.Dispatching.h>
namespace margelo::nitro {
static std::mutex uiMutex;
static winrt::Microsoft::ReactNative::ReactDispatcher ui{nullptr};
void SetWindowsUIDispatcher(winrt::Microsoft::ReactNative::ReactDispatcher const &value) { std::lock_guard lock(uiMutex); ui = value; }
std::string ThreadUtils::getThreadName() { PWSTR raw = nullptr; if (FAILED(GetThreadDescription(GetCurrentThread(), &raw))) return {}; std::string name = winrt::to_string(raw); LocalFree(raw); return name; }
void ThreadUtils::setThreadName(std::string const &name) { winrt::check_hresult(SetThreadDescription(GetCurrentThread(), winrt::to_hstring(name).c_str())); }
bool ThreadUtils::isUIThread() { return winrt::Microsoft::UI::Dispatching::DispatcherQueue::GetForCurrentThread() != nullptr; }
class WindowsUIDispatcher final : public Dispatcher {
  winrt::Microsoft::ReactNative::ReactDispatcher queue{nullptr};
public:
  WindowsUIDispatcher() { std::lock_guard lock(uiMutex); queue = ui; if (!queue) throw std::runtime_error("Windows UI dispatcher is not initialized"); }
  void runAsync(std::function<void()> &&fn) override { queue.Post([fn = std::move(fn)]() { fn(); }); }
  void runSync(std::function<void()> &&fn) override { if (queue.HasThreadAccess()) { fn(); return; } auto task = std::make_shared<std::packaged_task<void()>>(std::move(fn)); auto done = task->get_future(); runAsync([task]() { (*task)(); }); done.get(); }
};
std::shared_ptr<Dispatcher> ThreadUtils::createUIThreadDispatcher() { return std::make_shared<WindowsUIDispatcher>(); }
void Logger::nativeLog(LogLevel, char const *tag, std::string const &text) { OutputDebugStringA((std::string(tag) + ": " + text + "\n").c_str()); }
}
