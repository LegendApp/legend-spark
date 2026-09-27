#pragma once
#include "NativeModules.h"
#include <algorithm>
#include <map>
#include <set>
#include <memory>
#include <filesystem>
#include <powrprof.h>
#include <wtsapi32.h>
#include <shobjidl.h>
#include <shlobj.h>
#include <propkey.h>
#include <propvarutil.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.UI.ViewManagement.h>
#include <winrt/Windows.System.Profile.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <winrt/Windows.Security.Cryptography.Core.h>
#pragma comment(lib, "PowrProf.lib")
#pragma comment(lib, "Wtsapi32.lib")
#pragma comment(lib, "Shell32.lib")
#pragma comment(lib, "Propsys.lib")
#pragma comment(lib, "Gdi32.lib")
namespace winrt::SparkSystem {
namespace React = Microsoft::ReactNative;
namespace Json = Windows::Data::Json;
inline HWND MainWindow() {
  struct Search { HWND result = nullptr; } search;
  EnumWindows([](HWND hwnd, LPARAM value) -> BOOL { DWORD process; GetWindowThreadProcessId(hwnd, &process); if (process == GetCurrentProcessId() && GetPropW(hwnd, L"Spark.Window.main")) { reinterpret_cast<Search *>(value)->result = hwnd; return FALSE; } return TRUE; }, reinterpret_cast<LPARAM>(&search));
  if (!search.result) throw hresult_error(E_FAIL, L"Main window is unavailable"); return search.result;
}
inline std::wstring Env(wchar_t const *name) { auto length = GetEnvironmentVariableW(name, nullptr, 0); if (!length) return {}; std::wstring value(length, L'\0'); value.resize(GetEnvironmentVariableW(name, value.data(), length)); return value; }
inline std::wstring AppId() {
  auto project = Env(L"SPARK_PROJECT_ID"); if (project.empty()) throw hresult_invalid_argument(L"Missing project identity");
  using namespace Windows::Security::Cryptography;
  auto hash = Core::HashAlgorithmProvider::OpenAlgorithm(Core::HashAlgorithmNames::Sha256());
  return L"Spark." + std::wstring(CryptographicBuffer::EncodeToHexString(hash.HashData(CryptographicBuffer::ConvertStringToBinary(project, BinaryStringEncoding::Utf8))));
}
struct SystemState {
  React::ReactContext context;
  HWND hwnd = nullptr; bool observing = false;
  std::set<std::string> subscriptions;
  uint64_t sequence = 0;
  std::map<uint64_t, std::pair<handle, POWER_REQUEST_TYPE>> requests;
  std::map<uint64_t, bool> attention;
  std::wstring dockOwner;
  bool badge = false;
  void Emit(char const *type) { if (observing) context.EmitJSEvent(L"RCTDeviceEventEmitter", L"desktop", React::JSValueObject{{"type", type}}); }
  static LRESULT CALLBACK Proc(HWND hwnd, UINT message, WPARAM w, LPARAM l) noexcept {
    auto self = reinterpret_cast<SystemState *>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (self) try {
      if (message == WM_POWERBROADCAST) {
        if (w == PBT_APMSUSPEND) self->Emit("sleep");
        else if (w == PBT_APMRESUMEAUTOMATIC) self->Emit("wake");
        else if (w == PBT_APMPOWERSTATUSCHANGE) self->Emit("powerChanged");
      } else if (message == WM_WTSSESSION_CHANGE) { if (w == WTS_SESSION_LOCK) self->Emit("lock"); else if (w == WTS_SESSION_UNLOCK) self->Emit("unlock"); }
      else if (message == WM_SETTINGCHANGE || message == WM_THEMECHANGED) self->Emit("appearanceChanged");
      else if (message == WM_DISPLAYCHANGE) self->Emit("displaysChanged");
    } catch (...) {}
    return DefWindowProcW(hwnd, message, w, l);
  }
  void EnsureWindow() {
    if (hwnd) return;
    WNDCLASSW cls{}; cls.lpfnWndProc = Proc; cls.lpszClassName = L"SparkSystem"; cls.hInstance = GetModuleHandleW(nullptr);
    if (!RegisterClassW(&cls) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) throw_last_error();
    hwnd = CreateWindowExW(WS_EX_TOOLWINDOW, cls.lpszClassName, L"", WS_POPUP, 0, 0, 0, 0, nullptr, nullptr, cls.hInstance, nullptr);
    if (!hwnd) throw_last_error(); SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(this));
    if (!WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION)) { DestroyWindow(hwnd); hwnd = nullptr; throw_last_error(); }
  }
  static com_ptr<ITaskbarList3> Taskbar() { auto taskbar = create_instance<ITaskbarList3>(CLSID_TaskbarList); check_hresult(taskbar->HrInit()); return taskbar; }
  static HICON Badge(std::wstring const &label) {
    const int size = 32; BITMAPINFO info{}; info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER); info.bmiHeader.biWidth = size; info.bmiHeader.biHeight = -size; info.bmiHeader.biPlanes = 1; info.bmiHeader.biBitCount = 32;
    void *pixels = nullptr; auto color = CreateDIBSection(nullptr, &info, DIB_RGB_COLORS, &pixels, nullptr, 0); auto mask = CreateBitmap(size, size, 1, 1, nullptr); auto dc = CreateCompatibleDC(nullptr);
    if (!color || !mask || !dc) { if (color) DeleteObject(color); if (mask) DeleteObject(mask); if (dc) DeleteDC(dc); throw_last_error(); }
    auto old = SelectObject(dc, color); memset(pixels, 0, size * size * 4);
    auto brush = CreateSolidBrush(RGB(190, 0, 30)); auto oldBrush = SelectObject(dc, brush); auto oldPen = SelectObject(dc, GetStockObject(NULL_PEN)); Ellipse(dc, 0, 0, size, size);
    auto font = CreateFontW(-20, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET, 0, 0, ANTIALIASED_QUALITY, 0, L"Segoe UI"); auto oldFont = SelectObject(dc, font);
    SetTextColor(dc, RGB(255, 255, 255)); SetBkMode(dc, TRANSPARENT); RECT rect{0, 0, size, size}; DrawTextW(dc, label.c_str(), static_cast<int>(label.size()), &rect, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    auto bytes = static_cast<DWORD *>(pixels); for (int i = 0; i < size * size; ++i) if (bytes[i] & 0xffffff) bytes[i] |= 0xff000000;
    SelectObject(dc, oldFont); SelectObject(dc, oldBrush); SelectObject(dc, oldPen); SelectObject(dc, old); DeleteObject(font); DeleteObject(brush); DeleteDC(dc);
    ICONINFO icon{}; icon.fIcon = TRUE; icon.hbmColor = color; icon.hbmMask = mask; auto result = CreateIconIndirect(&icon); DeleteObject(color); DeleteObject(mask); if (!result) throw_last_error(); return result;
  }
  void ClearDock() { auto list = create_instance<ICustomDestinationList>(CLSID_DestinationList); check_hresult(list->SetAppID(AppId().c_str())); UINT slots; com_ptr<IObjectArray> removed; check_hresult(list->BeginList(&slots, IID_PPV_ARGS(removed.put()))); check_hresult(list->CommitList()); dockOwner.clear(); }
  void DockMenu(Json::JsonObject const &args) {
    auto list = create_instance<ICustomDestinationList>(CLSID_DestinationList); check_hresult(list->SetAppID(AppId().c_str()));
    UINT slots; com_ptr<IObjectArray> removed; check_hresult(list->BeginList(&slots, IID_PPV_ARGS(removed.put())));
    try {
      auto tasks = create_instance<IObjectCollection>(CLSID_EnumerableObjectCollection);
      wchar_t executable[32768]{}; GetModuleFileNameW(nullptr, executable, 32768);
      auto owner = args.GetNamedString(L"owner");
      for (auto const &value : args.GetNamedArray(L"items")) {
        auto item = value.GetObject(); if (!item.GetNamedBoolean(L"enabled", true)) continue;
        auto link = create_instance<IShellLinkW>(CLSID_ShellLink); check_hresult(link->SetPath(executable));
        auto payload = std::wstring(Windows::Foundation::Uri::EscapeComponent(owner)) + L":" + std::wstring(Windows::Foundation::Uri::EscapeComponent(item.GetNamedString(L"id")));
        Json::JsonObject launch;
        for (auto key : {L"SPARK_PROJECT_ID", L"SPARK_PROJECT_NAME", L"SPARK_PROJECT_VERSION", L"SPARK_WINDOW_CONFIG", L"SPARK_SESSION_FILE"}) launch.SetNamedValue(key, Json::JsonValue::CreateStringValue(Env(key)));
        auto command = L"--spark-context=" + std::wstring(Windows::Foundation::Uri::EscapeComponent(launch.Stringify())) + L" --spark-dock-action=" + std::wstring(payload); check_hresult(link->SetArguments(command.c_str()));
        check_hresult(link->SetIconLocation(executable, 0));
        auto title = (item.GetNamedBoolean(L"checked", false) ? std::wstring(L"\u2713 ") : std::wstring()) + std::wstring(item.GetNamedString(L"title"));
        auto properties = link.as<IPropertyStore>(); PROPVARIANT titleValue{}; check_hresult(InitPropVariantFromString(title.c_str(), &titleValue));
        auto result = properties->SetValue(PKEY_Title, titleValue); PropVariantClear(&titleValue); check_hresult(result); check_hresult(properties->Commit()); check_hresult(tasks->AddObject(link.get()));
      }
      auto array = tasks.as<IObjectArray>(); check_hresult(list->AddUserTasks(array.get())); check_hresult(list->CommitList()); dockOwner = std::wstring(owner);
    } catch (...) { list->AbortList(); throw; }
  }
  void Close() noexcept {
    for (auto &[id, request] : requests) { PowerClearRequest(request.first.get(), request.second); if (request.second == PowerRequestDisplayRequired) PowerClearRequest(request.first.get(), PowerRequestSystemRequired); } requests.clear();
    try { FLASHWINFO flash{sizeof(FLASHWINFO), MainWindow(), FLASHW_STOP, 0, 0}; FlashWindowEx(&flash); if (badge) Taskbar()->SetOverlayIcon(MainWindow(), nullptr, L""); if (!dockOwner.empty()) ClearDock(); } catch (...) {}
    if (hwnd) { WTSUnRegisterSessionNotification(hwnd); DestroyWindow(hwnd); hwnd = nullptr; }
  }
  static Json::JsonObject Info() {
    Json::JsonObject result; auto version = std::stoull(std::wstring(Windows::System::Profile::AnalyticsInfo::VersionInfo().DeviceFamilyVersion()));
    auto number = [&](wchar_t const *key, double value) { result.SetNamedValue(key, Json::JsonValue::CreateNumberValue(value)); };
    result.SetNamedValue(L"osVersion", Json::JsonValue::CreateStringValue(std::to_wstring(version >> 48) + L"." + std::to_wstring((version >> 32) & 0xffff) + L"." + std::to_wstring((version >> 16) & 0xffff)));
    SYSTEM_INFO info{}; ::GetSystemInfo(&info); result.SetNamedValue(L"architecture", Json::JsonValue::CreateStringValue(info.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_ARM64 ? L"arm64" : info.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_AMD64 ? L"x64" : L"x86"));
    wchar_t locale[LOCALE_NAME_MAX_LENGTH]{}; GetUserDefaultLocaleName(locale, LOCALE_NAME_MAX_LENGTH); result.SetNamedValue(L"locale", Json::JsonValue::CreateStringValue(locale));
    Windows::UI::ViewManagement::UISettings settings; auto color = settings.GetColorValue(Windows::UI::ViewManagement::UIColorType::Background); result.SetNamedValue(L"dark", Json::JsonValue::CreateBooleanValue(color.R + color.G + color.B < 384));
    LASTINPUTINFO input{sizeof(LASTINPUTINFO)}; if (!GetLastInputInfo(&input)) throw_last_error(); number(L"idleSeconds", static_cast<DWORD>(GetTickCount() - input.dwTime) / 1000.0);
    SYSTEM_POWER_STATUS power{}; if (!GetSystemPowerStatus(&power)) throw_last_error(); result.SetNamedValue(L"onBattery", Json::JsonValue::CreateBooleanValue(power.ACLineStatus == 0));
    if (power.BatteryLifePercent <= 100 && !(power.BatteryFlag & 128)) number(L"batteryLevel", power.BatteryLifePercent / 100.0); else result.SetNamedValue(L"batteryLevel", Json::JsonValue::CreateNullValue());
    return result;
  }
};
REACT_MODULE(SparkSystem, L"NativeDesktopSystem")
struct SparkSystem {
  std::shared_ptr<SystemState> state = std::make_shared<SystemState>();
  REACT_INIT(Initialize) void Initialize(React::ReactContext const &context) noexcept { state->context = context; }
  ~SparkSystem() { auto current = state; if (current->context) current->context.UIDispatcher().Post([current]() { current->Close(); }); }
  REACT_METHOD(call) void call(std::string method, std::string encoded, React::ReactPromise<std::string> promise) noexcept {
    auto current = state;
    current->context.UIDispatcher().Post([current, method, encoded, promise]() {
      try {
        auto args = Json::JsonObject::Parse(to_hstring(encoded));
        if (method == "info") { promise.Resolve(to_string(SystemState::Info().Stringify())); return; }
        if (method == "observe") { current->EnsureWindow(); current->subscriptions.insert(to_string(args.GetNamedString(L"id"))); current->observing = true; }
        else if (method == "unobserve") { current->subscriptions.erase(to_string(args.GetNamedString(L"id"))); current->observing = !current->subscriptions.empty(); if (!current->observing && current->hwnd) { WTSUnRegisterSessionNotification(current->hwnd); DestroyWindow(current->hwnd); current->hwnd = nullptr; } }
        else if (method == "loginStatus") { promise.Resolve("\"unavailable\""); return; }
        else if (method == "login") { promise.Reject(React::ReactError{"E_UNAVAILABLE", "Login startup requires a standalone distribution app"}); return; }
        else if (method == "badge") { auto label = args.GetNamedString(L"label"); HICON icon = label.empty() ? nullptr : SystemState::Badge(std::wstring(label)); auto result = SystemState::Taskbar()->SetOverlayIcon(MainWindow(), icon, label.c_str()); if (icon) DestroyIcon(icon); check_hresult(result); current->badge = !label.empty(); }
        else if (method == "attention") { auto id = ++current->sequence; bool critical = args.GetNamedBoolean(L"critical", false); current->attention[id] = critical; FLASHWINFO flash{sizeof(FLASHWINFO), MainWindow(), static_cast<DWORD>(FLASHW_TRAY | (critical ? FLASHW_TIMERNOFG : 0)), critical ? 0u : 3u, 0}; FlashWindowEx(&flash); promise.Resolve(std::to_string(id)); return; }
        else if (method == "cancelAttention") { current->attention.erase(static_cast<uint64_t>(args.GetNamedNumber(L"id"))); if (current->attention.empty()) { FLASHWINFO flash{sizeof(FLASHWINFO), MainWindow(), FLASHW_STOP, 0, 0}; FlashWindowEx(&flash); } }
        else if (method == "preventSleep") {
          auto reason = args.GetNamedString(L"reason"); REASON_CONTEXT description{}; description.Version = POWER_REQUEST_CONTEXT_VERSION; description.Flags = POWER_REQUEST_CONTEXT_SIMPLE_STRING; description.Reason.SimpleReasonString = const_cast<wchar_t *>(reason.c_str());
          handle request{PowerCreateRequest(&description)}; if (!request || request.get() == INVALID_HANDLE_VALUE) { request.detach(); throw_last_error(); } auto kind = args.GetNamedString(L"kind") == L"system" ? PowerRequestSystemRequired : PowerRequestDisplayRequired;
          if (!PowerSetRequest(request.get(), kind)) throw_last_error(); if (kind == PowerRequestDisplayRequired && !PowerSetRequest(request.get(), PowerRequestSystemRequired)) throw_last_error();
          auto id = ++current->sequence; current->requests.emplace(id, std::make_pair(std::move(request), kind)); promise.Resolve(std::to_string(id)); return;
        } // Closing the dedicated handle releases every request held by this registration.
        else if (method == "allowSleep") { current->requests.erase(static_cast<uint64_t>(args.GetNamedNumber(L"id"))); }
        else if (method == "dockMenu") { if (!current->dockOwner.empty()) { promise.Reject(React::ReactError{"E_ALREADY_EXISTS", "Remove the existing taskbar menu before replacing it"}); return; } current->DockMenu(args); }
        else if (method == "clearDockMenu") { if (current->dockOwner == std::wstring(args.GetNamedString(L"owner"))) current->ClearDock(); }
        else throw hresult_invalid_argument(L"Unknown system operation");
        promise.Resolve("null");
      } catch (hresult_error const &error) { promise.Reject(React::ReactError{"E_SYSTEM", to_string(error.message())}); }
      catch (std::exception const &error) { promise.Reject(React::ReactError{"E_SYSTEM", error.what()}); }
    });
  }
};
}
