#pragma once
#include "NativeModules.h"
#include <shellapi.h>
#include <windowsx.h>
#include <map>
#include <memory>
#include <vector>
#include <winrt/Windows.Data.Json.h>
#pragma comment(lib, "Shell32.lib")
#pragma comment(lib, "Gdi32.lib")
namespace winrt::SparkTray {
namespace React = Microsoft::ReactNative;
namespace Json = Windows::Data::Json;
struct TrayState : std::enable_shared_from_this<TrayState> {
  struct Item { std::string id; Json::JsonObject options; HICON icon = nullptr; };
  HWND hwnd = nullptr; UINT sequence = 0, taskbarCreated = RegisterWindowMessageW(L"TaskbarCreated");
  React::ReactContext context;
  std::map<UINT, Item> items;
  static constexpr UINT Callback = WM_APP + 17;
  NOTIFYICONDATAW Data(UINT key, Item const &item) {
    NOTIFYICONDATAW data{}; data.cbSize = sizeof(data); data.hWnd = hwnd; data.uID = key;
    data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP; data.uCallbackMessage = Callback; data.hIcon = item.icon;
    auto tip = item.options.GetNamedString(L"tooltip", item.options.GetNamedString(L"title", L"Spark"));
    wcsncpy_s(data.szTip, tip.c_str(), _TRUNCATE); return data;
  }
  void Publish(UINT key, Item const &item, DWORD operation) {
    auto data = Data(key, item);
    if (!Shell_NotifyIconW(operation, &data)) throw hresult_error(E_FAIL, L"Windows could not update the tray icon");
    if (operation == NIM_ADD) { data.uVersion = NOTIFYICON_VERSION_4; Shell_NotifyIconW(NIM_SETVERSION, &data); }
  }
  static HICON Icon(Json::JsonObject const &options) {
    // Windows has no SF Symbols or tray text label. Its app icon identifies the
    // item; title supplies its accessible tooltip when no tooltip is specified.
    HICON large = nullptr, small = nullptr; wchar_t executable[32768]{};
    GetModuleFileNameW(nullptr, executable, 32768);
    ExtractIconExW(executable, 0, &large, &small, 1);
    if (large) DestroyIcon(large);
    if (small) return small;
    auto icon = CopyIcon(LoadIconW(nullptr, IDI_APPLICATION)); if (!icon) throw_last_error(); return icon;
  }
  static HMENU Menu(Json::JsonArray const &entries, std::map<UINT, std::string> &actions, UINT &sequence, int depth = 0) {
    if (depth > 5) throw hresult_invalid_argument(L"Tray menu nesting exceeds five levels");
    auto menu = CreatePopupMenu(); if (!menu) throw_last_error();
    try {
      for (auto const &value : entries) {
        auto item = value.GetObject();
        if (item.GetNamedBoolean(L"separator", false)) { if (!AppendMenuW(menu, MF_SEPARATOR, 0, nullptr)) throw_last_error(); continue; }
        auto flags = MF_STRING | (item.GetNamedBoolean(L"enabled", true) ? MF_ENABLED : MF_GRAYED) | (item.GetNamedBoolean(L"checked", false) ? MF_CHECKED : 0);
        // Escape ampersands: titles are literal strings in the shared API.
        std::wstring title; for (auto c : item.GetNamedString(L"title")) { title += c; if (c == L'&') title += c; }
        if (item.HasKey(L"items")) {
          auto child = Menu(item.GetNamedArray(L"items"), actions, sequence, depth + 1);
          if (!AppendMenuW(menu, flags | MF_POPUP, reinterpret_cast<UINT_PTR>(child), title.c_str())) { DestroyMenu(child); throw_last_error(); }
        } else {
          auto command = ++sequence; actions.emplace(command, to_string(item.GetNamedString(L"id")));
          if (!AppendMenuW(menu, flags, command, title.c_str())) throw_last_error();
        }
      }
      return menu;
    } catch (...) { DestroyMenu(menu); throw; }
  }
  void Select(UINT key, UINT event, LPARAM position) {
    auto keepAlive = shared_from_this();
    auto found = items.find(key); if (found == items.end()) return;
    const auto id = found->second.id;
    auto entries = found->second.options.GetNamedArray(L"menu", Json::JsonArray());
    if (event != NIN_SELECT && event != NIN_KEYSELECT && event != WM_CONTEXTMENU) return;
    if (entries.Size() == 0) { context.EmitJSEvent(L"RCTDeviceEventEmitter", L"desktop", React::JSValueObject{{"type", "trayClick"}, {"trayId", id}}); return; }
    std::map<UINT, std::string> actions; UINT command = 0; auto menu = Menu(entries, actions, command);
    POINT point{GET_X_LPARAM(position), GET_Y_LPARAM(position)}; if (point.x == -1 && point.y == -1) GetCursorPos(&point);
    SetForegroundWindow(hwnd);
    auto selected = TrackPopupMenuEx(menu, TPM_RETURNCMD | TPM_NONOTIFY | TPM_RIGHTBUTTON, point.x, point.y, hwnd, nullptr);
    DestroyMenu(menu); if (hwnd) PostMessageW(hwnd, WM_NULL, 0, 0);
    if (actions.count(selected) && items.count(key)) context.EmitJSEvent(L"RCTDeviceEventEmitter", L"desktop", React::JSValueObject{{"type", "trayAction"}, {"trayId", id}, {"itemId", actions.at(selected)}});
  }
  static LRESULT CALLBACK Proc(HWND hwnd, UINT message, WPARAM w, LPARAM l) noexcept {
    auto self = reinterpret_cast<TrayState *>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (self) try {
      if (message == Callback) { self->Select(HIWORD(l), LOWORD(l), static_cast<LPARAM>(w)); return 0; }
      if (message == self->taskbarCreated) { for (auto const &[key, item] : self->items) self->Publish(key, item, NIM_ADD); return 0; }
    } catch (...) { /* Explorer may be restarting; never unwind through User32. */ }
    return DefWindowProcW(hwnd, message, w, l);
  }
  void EnsureWindow() {
    if (hwnd) return;
    WNDCLASSW cls{}; cls.lpfnWndProc = Proc; cls.lpszClassName = L"SparkTray"; cls.hInstance = GetModuleHandleW(nullptr);
    if (!RegisterClassW(&cls) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) throw_last_error();
    // A hidden top-level window receives TaskbarCreated broadcasts; HWND_MESSAGE does not.
    hwnd = CreateWindowExW(WS_EX_TOOLWINDOW, cls.lpszClassName, L"", WS_POPUP, 0, 0, 0, 0, nullptr, nullptr, cls.hInstance, nullptr);
    if (!hwnd) throw_last_error(); SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(this));
  }
  void Remove(UINT key, bool strict = true) {
    auto found = items.find(key); if (found == items.end()) return;
    NOTIFYICONDATAW data{}; data.cbSize = sizeof(data); data.hWnd = hwnd; data.uID = key; if (!Shell_NotifyIconW(NIM_DELETE, &data) && strict) throw hresult_error(E_FAIL, L"Windows could not remove the tray icon");
    DestroyIcon(found->second.icon); items.erase(found);
  }
  void Close() noexcept { while (!items.empty()) Remove(items.begin()->first, false); if (hwnd) { DestroyWindow(hwnd); hwnd = nullptr; } }
};
REACT_MODULE(SparkTray, L"NativeDesktopTray")
struct SparkTray {
  std::shared_ptr<TrayState> state = std::make_shared<TrayState>();
  REACT_INIT(Initialize) void Initialize(React::ReactContext const &value) noexcept { state->context = value; }
  ~SparkTray() { auto current = std::move(state); if (current->context) current->context.UIDispatcher().Post([current]() { current->Close(); }); }
  REACT_METHOD(call)
  void call(std::string method, std::string encoded, React::ReactPromise<std::string> promise) noexcept {
    auto current = state;
    current->context.UIDispatcher().Post([current, method, encoded, promise]() {
      try {
        auto args = Json::JsonObject::Parse(to_hstring(encoded)); auto id = to_string(args.GetNamedString(L"id")); current->EnsureWindow();
        UINT key = 0; for (auto const &[number, item] : current->items) if (item.id == id) { key = number; break; }
        if (method == "remove") current->Remove(key);
        else if (method == "create" || method == "update") {
          if (method == "create" && key) { promise.Reject(React::ReactError{"E_ALREADY_EXISTS", "Tray id already exists"}); return; }
          if (method == "update" && !key) { promise.Reject(React::ReactError{"E_NOT_FOUND", "Tray was removed"}); return; }
          Json::JsonObject options = key ? Json::JsonObject::Parse(current->items.at(key).options.Stringify()) : Json::JsonObject();
          for (auto const &entry : args) options.SetNamedValue(entry.Key(), entry.Value());
          if (options.GetNamedString(L"title", L"").empty() && options.GetNamedString(L"symbol", L"").empty()) throw hresult_invalid_argument(L"Tray needs a title or symbol");
          // Validate menus before replacing a live icon.
          std::map<UINT, std::string> actions; UINT command = 0; auto menu = TrayState::Menu(options.GetNamedArray(L"menu", Json::JsonArray()), actions, command); DestroyMenu(menu);
          auto icon = TrayState::Icon(options); const bool creating = key == 0;
          if (creating) { for (UINT i = 0; i < 65535; ++i) { auto candidate = current->sequence = current->sequence % 65535 + 1; if (!current->items.count(candidate)) { key = candidate; break; } } }
          if (!key) { DestroyIcon(icon); throw hresult_error(E_FAIL, L"Too many tray items"); }
          TrayState::Item item{id, options, icon};
          try { current->Publish(key, item, creating ? NIM_ADD : NIM_MODIFY); } catch (...) { DestroyIcon(icon); throw; }
          if (!creating) DestroyIcon(current->items.at(key).icon);
          current->items.insert_or_assign(key, std::move(item));
        } else throw hresult_invalid_argument(L"Unknown tray operation");
        promise.Resolve("null");
      } catch (hresult_error const &error) { promise.Reject(React::ReactError{"E_TRAY", to_string(error.message())}); }
    });
  }
};
}
