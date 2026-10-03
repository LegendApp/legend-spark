#pragma once
#include "NativeModules.h"
#include <map>
#include <memory>
#include <winrt/Windows.Data.Json.h>
namespace winrt::SparkGlobalShortcuts {
namespace React = Microsoft::ReactNative;
namespace Json = Windows::Data::Json;
struct Hotkeys {
  HWND hwnd = nullptr;
  React::ReactContext context;
  std::map<int, std::string> keys;
  int sequence = 0;
  static LRESULT CALLBACK Proc(HWND hwnd, UINT message, WPARAM w, LPARAM l) noexcept {
    auto self = reinterpret_cast<Hotkeys *>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_HOTKEY && self) {
      auto found = self->keys.find(static_cast<int>(w));
      if (found != self->keys.end()) self->context.EmitJSEvent(L"RCTDeviceEventEmitter", L"desktop", React::JSValueObject{{"type", "globalShortcut"}, {"id", found->second}});
      return 0;
    }
    return DefWindowProcW(hwnd, message, w, l);
  }
  void EnsureWindow() {
    if (hwnd) return;
    static const wchar_t *name = L"SparkGlobalShortcuts";
    WNDCLASSW cls{}; cls.lpfnWndProc = Proc; cls.lpszClassName = name; cls.hInstance = GetModuleHandleW(nullptr);
    if (!RegisterClassW(&cls) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) throw_last_error();
    hwnd = CreateWindowExW(0, name, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, cls.hInstance, nullptr);
    if (!hwnd) throw_last_error();
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(this));
  }
  void Close() noexcept { if (hwnd) { for (auto const &[key, id] : keys) UnregisterHotKey(hwnd, key); keys.clear(); DestroyWindow(hwnd); hwnd = nullptr; } }
  static UINT Key(hstring const &text, UINT &modifiers) {
    if (text.size() != 1) throw hresult_invalid_argument(L"Shortcut must resolve to one key");
    auto key = text[0];
    if (key >= 0xf704 && key <= 0xf717) return VK_F1 + key - 0xf704;
    switch (key) {
      case 0xf700: return VK_UP; case 0xf701: return VK_DOWN; case 0xf702: return VK_LEFT; case 0xf703: return VK_RIGHT;
      case 0xf728: return VK_DELETE; case 0x7f: return VK_BACK; case '\r': return VK_RETURN; case '\t': return VK_TAB; case 0x1b: return VK_ESCAPE;
    }
    auto mapped = VkKeyScanW(key);
    if (mapped == -1) throw hresult_invalid_argument(L"Key is unavailable in the current keyboard layout");
    const auto shift = HIBYTE(mapped);
    if (shift & 1) modifiers |= MOD_SHIFT; if (shift & 2) modifiers |= MOD_CONTROL; if (shift & 4) modifiers |= MOD_ALT;
    return LOBYTE(mapped);
  }
};
REACT_MODULE(SparkGlobalShortcuts, L"NativeDesktopGlobalShortcuts")
struct SparkGlobalShortcuts {
  std::shared_ptr<Hotkeys> state = std::make_shared<Hotkeys>();
  REACT_INIT(Initialize) void Initialize(React::ReactContext const &context) noexcept { state->context = context; }
  ~SparkGlobalShortcuts() { auto current = std::move(state); if (current->context) current->context.UIDispatcher().Post([current]() { current->Close(); }); }
  REACT_METHOD(call)
  void call(std::string method, std::string encoded, React::ReactPromise<std::string> promise) noexcept {
    auto current = state;
    current->context.UIDispatcher().Post([current, method, encoded, promise]() {
      try {
        auto args = Json::JsonObject::Parse(to_hstring(encoded)); auto id = to_string(args.GetNamedString(L"id"));
        current->EnsureWindow();
        if (method == "remove") {
          for (auto item = current->keys.begin(); item != current->keys.end(); ++item) if (item->second == id) { if (!UnregisterHotKey(current->hwnd, item->first)) winrt::throw_last_error(); current->keys.erase(item); break; }
        } else if (method == "register") {
          for (auto const &[key, existing] : current->keys) if (existing == id) { promise.Reject(React::ReactError{"E_BUSY", "Shortcut id already exists"}); return; }
          auto flags = static_cast<int>(args.GetNamedNumber(L"modifiers"));
          // MOD_NOREPEAT suppresses OS auto-repeat; repeat:true registers with repeats.
          UINT modifiers = args.GetNamedBoolean(L"repeat", false) ? 0 : MOD_NOREPEAT;
          if (flags & (1 << 17)) modifiers |= MOD_SHIFT; if (flags & (1 << 18)) modifiers |= MOD_CONTROL;
          if (flags & (1 << 19)) modifiers |= MOD_ALT; if (flags & (1 << 20)) modifiers |= MOD_WIN;
          const auto key = Hotkeys::Key(args.GetNamedString(L"key"), modifiers);
          // Window-local registration IDs must remain within the documented range.
          int identifier = 0;
          for (int i = 0; i < 0xbfff; ++i) { int candidate = current->sequence = current->sequence % 0xbfff + 1; if (!current->keys.count(candidate)) { identifier = candidate; break; } }
          if (!identifier || !RegisterHotKey(current->hwnd, identifier, modifiers, key)) { promise.Reject(React::ReactError{"E_BUSY", "Shortcut is unavailable or reserved by another app"}); return; }
          current->keys.emplace(identifier, id);
        } else throw hresult_invalid_argument(L"Unknown global shortcut operation");
        promise.Resolve("null");
      } catch (hresult_error const &error) { promise.Reject(React::ReactError{"E_SHORTCUT", to_string(error.message())}); }
    });
  }
};
}
