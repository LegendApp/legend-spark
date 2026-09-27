#pragma once
#include "NativeModules.h"
#include <commctrl.h>
#include <winrt/Windows.Data.Json.h>
#include <atomic>
#include <functional>
#include <memory>
#include <vector>
#include <set>
#include <cmath>
#include <climits>
#pragma comment(lib, "Comctl32.lib")
namespace winrt::SparkContextMenu {
namespace React = Microsoft::ReactNative;
namespace Json = Windows::Data::Json;
// Match the framework's own top-level windows, never another process's HWND.
inline HWND Parent(std::wstring const &id, bool explicitId) {
  HWND active = GetActiveWindow();
  if (!explicitId && active && GetPropW(active, L"Spark.ReactWindow")) return active;
  struct Search { std::wstring property; HWND found = nullptr; } search{L"Spark.Window." + (explicitId ? id : L"main")};
  EnumWindows([](HWND hwnd, LPARAM value) -> BOOL {
    auto search = reinterpret_cast<Search *>(value); DWORD process = 0; GetWindowThreadProcessId(hwnd, &process);
    if (process == GetCurrentProcessId() && GetPropW(hwnd, search->property.c_str())) { search->found = hwnd; return FALSE; }
    return TRUE;
  }, reinterpret_cast<LPARAM>(&search));
  return search.found;
}
// Modal Win32 APIs pump a nested loop. Start outside the RN dispatcher callback
// so React can still deliver another call (which must reject E_BUSY).
inline LRESULT CALLBACK TaskProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  if (message == WM_NCCREATE) {
    auto pending = reinterpret_cast<std::unique_ptr<std::function<void()>> *>(reinterpret_cast<CREATESTRUCTW *>(lparam)->lpCreateParams);
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(pending->release()));
  }
  if (message == WM_APP + 1) {
    auto raw = reinterpret_cast<std::function<void()> *>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0); std::unique_ptr<std::function<void()>> action(raw); DestroyWindow(hwnd);
    if (action) (*action)(); return 0;
  }
  if (message == WM_NCDESTROY) {
    delete reinterpret_cast<std::function<void()> *>(GetWindowLongPtrW(hwnd, GWLP_USERDATA)); SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
  }
  return DefWindowProcW(hwnd, message, wparam, lparam);
}
inline void Schedule(React::ReactContext context, std::function<void()> action, std::function<void()> failure) {
  context.UIDispatcher().Post([action = std::move(action), failure = std::move(failure)]() {
    const wchar_t *name = L"SparkContextMenuTask";
    WNDCLASSW cls{}; cls.lpfnWndProc = TaskProc; cls.hInstance = GetModuleHandleW(nullptr); cls.lpszClassName = name;
    if (!RegisterClassW(&cls) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) { failure(); return; }
    auto pending = std::make_unique<std::function<void()>>(action);
    // Ownership passes on WM_NCCREATE. This class always accepts creation.
    auto hwnd = CreateWindowExW(0, name, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, cls.hInstance, &pending);
    if (!hwnd) { failure(); return; }
    if (!PostMessageW(hwnd, WM_APP + 1, 0, 0)) { DestroyWindow(hwnd); failure(); }
  });
}
struct MenuState {
  std::atomic<bool> busy{false}, stopped{false};
  std::atomic<HWND> owner{nullptr};
};
struct MenuHandle { HMENU value = CreatePopupMenu(); ~MenuHandle() { if (value) DestroyMenu(value); } };
REACT_MODULE(SparkContextMenu, L"NativeContextMenu")
struct SparkContextMenu {
  React::ReactContext context;
  std::shared_ptr<MenuState> state = std::make_shared<MenuState>();
  REACT_INIT(Initialize) void Initialize(React::ReactContext const &value) noexcept { context = value; }
  ~SparkContextMenu() {
    state->stopped = true;
    if (auto owner = state->owner.load()) PostMessageW(owner, WM_CANCELMODE, 0, 0);
  }
  REACT_METHOD(showMenu) void showMenu(std::string encoded, std::string location, React::ReactPromise<std::string> promise) noexcept {
    if (state->busy.exchange(true)) { promise.Reject(React::ReactError{"E_BUSY", "A context menu is already open"}); return; }
    auto current = state;
    Schedule(context, [current, encoded, location, promise] {
      try {
        if (current->stopped) { current->busy = false; promise.Resolve(""); return; }
        auto items = Json::JsonArray::Parse(to_hstring(encoded));
        auto position = Json::JsonObject::Parse(to_hstring(location));
        auto owner = Parent(std::wstring(position.GetNamedString(L"windowId")), true);
        if (!owner) { current->busy = false; promise.Reject(React::ReactError{"E_NOT_FOUND", "Context menu owner window does not exist"}); return; }
        if (items.Size() == 0) { current->busy = false; promise.Resolve(""); return; }
        if (!IsWindowEnabled(owner)) { current->busy = false; promise.Reject(React::ReactError{"E_BUSY", "Menu parent has a modal operation"}); return; }
        const double x = position.GetNamedNumber(L"x"), y = position.GetNamedNumber(L"y");
        const double scale = static_cast<double>(GetDpiForWindow(owner)) / 96.0;
        if (!std::isfinite(x) || !std::isfinite(y) || std::abs(x * scale) > INT_MAX / 2 || std::abs(y * scale) > INT_MAX / 2) throw hresult_invalid_argument(L"Menu location must be finite and within screen coordinates");
        POINT point{static_cast<LONG>(std::lround(x * scale)), static_cast<LONG>(std::lround(y * scale))};
        if (!ClientToScreen(owner, &point)) throw_last_error();
        MenuHandle menu; if (!menu.value) throw_last_error();
        std::vector<std::string> ids; std::set<std::string> unique;
        for (auto const &value : items) {
          auto item = value.GetObject();
          if (item.GetNamedBoolean(L"separator", false)) { if (!AppendMenuW(menu.value, MF_SEPARATOR, 0, nullptr)) throw_last_error(); continue; }
          auto id = to_string(item.GetNamedString(L"id"));
          if (!unique.insert(id).second) throw hresult_invalid_argument(L"Context menu ids must be unique");
          ids.push_back(id); std::wstring label;
          for (auto c : std::wstring(item.GetNamedString(L"title"))) { label += c; if (c == L'&') label += L'&'; }
          UINT flags = MF_STRING;
          if (!item.GetNamedBoolean(L"enabled", true)) flags |= MF_GRAYED;
          if (item.GetNamedBoolean(L"checked", false)) flags |= MF_CHECKED;
          if (!AppendMenuW(menu.value, flags, static_cast<UINT_PTR>(ids.size()), label.c_str())) throw_last_error();
        }
        current->owner = owner;
        SetLastError(ERROR_SUCCESS);
        const auto selected = TrackPopupMenuEx(menu.value, TPM_RETURNCMD | TPM_NONOTIFY | TPM_RIGHTBUTTON, point.x, point.y, owner, nullptr);
        const auto error = GetLastError(); current->owner = nullptr; current->busy = false;
        if (!selected && error != ERROR_SUCCESS) throw hresult_error(HRESULT_FROM_WIN32(error));
        promise.Resolve(!current->stopped && selected > 0 && static_cast<size_t>(selected) <= ids.size() ? ids[selected - 1] : "");
      } catch (hresult_error const &error) { current->owner = nullptr; current->busy = false; promise.Reject(React::ReactError{error.code() == E_INVALIDARG ? "E_INVALID_ARGUMENT" : "E_MENU", to_string(error.message())}); }
      catch (std::exception const &error) { current->owner = nullptr; current->busy = false; promise.Reject(React::ReactError{"E_MENU", error.what()}); }
    }, [current, promise] { current->busy = false; promise.Reject(React::ReactError{"E_MENU", "Could not schedule native menu"}); });
  }
};
}
