#pragma once
#include "NativeModules.h"
#include <shobjidl.h>
#include <shlobj.h>
#include <propkey.h>
#include <propvarutil.h>
#include <filesystem>
#include <map>
#include <memory>
#include <cstdint>
#include <cmath>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Data.Xml.Dom.h>
#include <winrt/Windows.UI.Notifications.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <winrt/Windows.Security.Cryptography.Core.h>
#pragma comment(lib, "Ole32.lib")
#pragma comment(lib, "Advapi32.lib")
#pragma comment(lib, "Propsys.lib")
namespace winrt::SparkNotifications {
namespace React = Microsoft::ReactNative;
namespace Json = Windows::Data::Json;
namespace Toast = Windows::UI::Notifications;
namespace Xml = Windows::Data::Xml::Dom;
inline std::wstring Env(wchar_t const *key) {
  auto size = GetEnvironmentVariableW(key, nullptr, 0); if (!size) return {};
  std::wstring value(size, L'\0'); value.resize(GetEnvironmentVariableW(key, value.data(), size)); return value;
}
inline std::wstring Hash(hstring const &value) {
  using namespace Windows::Security::Cryptography;
  auto algorithm = Core::HashAlgorithmProvider::OpenAlgorithm(Core::HashAlgorithmNames::Sha256());
  return std::wstring(CryptographicBuffer::EncodeToHexString(algorithm.HashData(CryptographicBuffer::ConvertStringToBinary(value, BinaryStringEncoding::Utf8))));
}
inline void Registry(std::wstring const &path, wchar_t const *name, std::wstring const &value) {
  HKEY key{}; auto status = RegCreateKeyExW(HKEY_CURRENT_USER, path.c_str(), 0, nullptr, 0, KEY_SET_VALUE, nullptr, &key, nullptr);
  check_win32(status); status = RegSetValueExW(key, name, 0, REG_SZ, reinterpret_cast<BYTE const *>(value.c_str()), static_cast<DWORD>((value.size() + 1) * sizeof(wchar_t))); RegCloseKey(key); check_win32(status);
}
struct NotificationsState : std::enable_shared_from_this<NotificationsState> {
  React::ReactContext context;
  std::wstring project, appId;
  Toast::ToastNotifier notifier{nullptr};
  struct Live { Toast::ToastNotification toast{nullptr}; event_token dismissed; uint64_t generation; };
  std::map<std::wstring, Live> live;
  uint64_t nextGeneration = 0;
  static constexpr wchar_t const *group = L"Spark";
  void Ensure() {
    if (notifier) return;
    project = Env(L"SPARK_PROJECT_ID"); if (project.empty()) throw hresult_invalid_argument(L"Missing project identity");
    auto key = Hash(project); appId = L"Spark." + key;
    auto classId = L"{" + key.substr(0, 8) + L"-" + key.substr(8, 4) + L"-" + key.substr(12, 4) + L"-" + key.substr(16, 4) + L"-" + key.substr(20, 12) + L"}";
    wchar_t executable[32768]{}; if (!GetModuleFileNameW(nullptr, executable, 32768)) throw_last_error();
    Json::JsonObject launch;
    for (auto name : {L"SPARK_PROJECT_ID", L"SPARK_PROJECT_NAME", L"SPARK_PROJECT_VERSION", L"SPARK_WINDOW_CONFIG", L"SPARK_SESSION_FILE"}) launch.SetNamedValue(name, Json::JsonValue::CreateStringValue(Env(name)));
    auto arguments = L"--spark-context=" + std::wstring(Windows::Foundation::Uri::EscapeComponent(launch.Stringify()));
    Registry(L"Software\\Classes\\CLSID\\" + classId + L"\\LocalServer32", nullptr, L"\"" + std::wstring(executable) + L"\" " + arguments + L" --spark-toast-server");
    Registry(L"Software\\Classes\\AppUserModelId\\" + appId, L"DisplayName", Env(L"SPARK_PROJECT_NAME"));
    Registry(L"Software\\Classes\\AppUserModelId\\" + appId, L"CustomActivator", classId);
    // Classic desktop toast activation requires a Start menu identity, scoped to this project.
    auto link = create_instance<IShellLinkW>(CLSID_ShellLink); check_hresult(link->SetPath(executable)); check_hresult(link->SetArguments(arguments.c_str())); check_hresult(link->SetIconLocation(executable, 0));
    auto properties = link.as<IPropertyStore>(); PROPVARIANT value{}; check_hresult(InitPropVariantFromString(appId.c_str(), &value));
    auto result = properties->SetValue(PKEY_AppUserModel_ID, value); PropVariantClear(&value); check_hresult(result);
    auto guid = winrt::guid(classId); check_hresult(InitPropVariantFromCLSID(guid, &value)); result = properties->SetValue(PKEY_AppUserModel_ToastActivatorCLSID, value); PropVariantClear(&value); check_hresult(result); check_hresult(properties->Commit());
    PWSTR raw = nullptr; check_hresult(SHGetKnownFolderPath(FOLDERID_Programs, 0, nullptr, &raw)); std::filesystem::path folder(raw); CoTaskMemFree(raw);
    check_hresult(link.as<IPersistFile>()->Save((folder / (L"Spark-" + key + L".lnk")).c_str(), TRUE));
    auto candidate = Toast::ToastNotificationManager::CreateToastNotifier(appId);
    // Like ToastNotificationManagerCompat.PreRegisterIdentityLessApp: an unpackaged
    // identity must send once before Setting/GetScheduledToastNotifications work.
    auto registration = L"Software\\Spark\\" + appId;
    DWORD registered = 0, bytes = sizeof(registered);
    if (RegGetValueW(HKEY_CURRENT_USER, registration.c_str(), L"ToastRegistered", RRF_RT_REG_DWORD, nullptr, &registered, &bytes) != ERROR_SUCCESS || !registered) {
      Xml::XmlDocument xml; xml.LoadXml(L"<toast><visual><binding template='ToastGeneric'><text>Notifications enabled</text></binding></visual></toast>");
      Toast::ToastNotification bootstrap(xml); bootstrap.SuppressPopup(true); bootstrap.Tag(L"bootstrap"); bootstrap.Group(L"SparkBootstrap"); bootstrap.ExpirationTime(clock::now() + std::chrono::seconds(15));
      candidate.Show(bootstrap); Toast::ToastNotificationManager::History().Remove(L"bootstrap", L"SparkBootstrap", appId);
      HKEY registry{}; check_win32(RegCreateKeyExW(HKEY_CURRENT_USER, registration.c_str(), 0, nullptr, 0, KEY_SET_VALUE, nullptr, &registry, nullptr)); registered = 1;
      auto status = RegSetValueExW(registry, L"ToastRegistered", 0, REG_DWORD, reinterpret_cast<BYTE *>(&registered), sizeof(registered)); RegCloseKey(registry); check_win32(status);
    }
    notifier = candidate;
  }
  void Forget(std::wstring const &tag) { auto entry = live.find(tag); if (entry != live.end()) { entry->second.toast.Dismissed(entry->second.dismissed); live.erase(entry); } }
  void Retire(std::wstring const &tag, uint64_t generation, bool userDismissed, std::wstring const &encoded) {
    auto entry = live.find(tag);
    if (entry == live.end() || entry->second.generation != generation) return;
    Forget(tag);
    if (userDismissed) Dismiss(hstring(encoded));
  }
  void Close() noexcept { for (auto &[tag, item] : live) try { item.toast.Dismissed(item.dismissed); } catch (...) {} live.clear(); }
  void RemovePending(std::wstring const &tag) { for (auto const &item : notifier.GetScheduledToastNotifications()) if (item.Group() == group && (tag.empty() || item.Tag() == tag)) notifier.RemoveFromSchedule(item); }
  static hstring Id(Xml::XmlDocument const &xml) { return Json::JsonObject::Parse(xml.DocumentElement().GetAttribute(L"launch")).GetNamedString(L"notificationId"); }
  void Dismiss(hstring const &encoded) {
    struct Search { HWND hwnd = nullptr; } found;
    EnumWindows([](HWND hwnd, LPARAM state) -> BOOL { DWORD process; GetWindowThreadProcessId(hwnd, &process); if (process == GetCurrentProcessId() && GetPropW(hwnd, L"Spark.Window.main")) { reinterpret_cast<Search *>(state)->hwnd = hwnd; return FALSE; } return TRUE; }, reinterpret_cast<LPARAM>(&found));
    if (found.hwnd) { COPYDATASTRUCT data{0x4C4E, static_cast<DWORD>((encoded.size() + 1) * sizeof(wchar_t)), const_cast<wchar_t *>(encoded.c_str())}; SendMessageW(found.hwnd, WM_COPYDATA, 0, reinterpret_cast<LPARAM>(&data)); }
  }
  void Show(Json::JsonObject const &args) {
    if (notifier.Setting() != Toast::NotificationSetting::Enabled) throw hresult_access_denied(L"Notifications are disabled in Windows settings");
    auto id = args.GetNamedString(L"id"), title = args.GetNamedString(L"title");
    auto delay = args.GetNamedNumber(L"delay", 0);
    if (id.empty() || title.empty() || !std::isfinite(delay) || delay < 0 || delay > 315360000) throw hresult_invalid_argument(L"Invalid notification or delay (maximum ten years)");
    Json::JsonObject response; response.SetNamedValue(L"project", Json::JsonValue::CreateStringValue(project)); response.SetNamedValue(L"notificationId", Json::JsonValue::CreateStringValue(id)); response.SetNamedValue(L"data", args.GetNamedObject(L"data", Json::JsonObject())); response.SetNamedValue(L"action", Json::JsonValue::CreateStringValue(L"open"));
    Xml::XmlDocument xml; xml.LoadXml(L"<toast><visual><binding template='ToastGeneric'/></visual></toast>"); xml.DocumentElement().SetAttribute(L"launch", response.Stringify());
    auto binding = xml.SelectSingleNode(L"/toast/visual/binding");
    for (auto field : {L"title", L"subtitle", L"body"}) { auto text = args.GetNamedString(field, L""); if (!text.empty()) { auto node = xml.CreateElement(L"text"); node.AppendChild(xml.CreateTextNode(text)); binding.AppendChild(node); } }
    if (!args.GetNamedBoolean(L"sound", true)) { auto audio = xml.CreateElement(L"audio"); audio.SetAttribute(L"silent", L"true"); xml.DocumentElement().AppendChild(audio); }
    auto tag = Hash(id); RemovePending(tag); Forget(tag);
    if (delay > 0) {
      Toast::ScheduledToastNotification toast(xml, clock::now() + std::chrono::milliseconds(static_cast<int64_t>(delay * 1000))); toast.Tag(tag); toast.Group(group); notifier.AddToSchedule(toast);
    } else {
      Toast::ToastNotification toast(xml); toast.Tag(tag); toast.Group(group);
      response.SetNamedValue(L"action", Json::JsonValue::CreateStringValue(L"dismiss")); auto encoded = response.Stringify(); auto weak = weak_from_this(); auto dispatcher = context.UIDispatcher();
      const auto generation = ++nextGeneration;
      auto token = toast.Dismissed([weak, dispatcher, tag, generation, encoded](auto const &, Toast::ToastDismissedEventArgs const &event) {
        const bool userDismissed = event.Reason() == Toast::ToastDismissalReason::UserCanceled;
        dispatcher.Post([weak, tag, generation, userDismissed, encoded]() { if (auto state = weak.lock()) state->Retire(tag, generation, userDismissed, encoded); });
      });
      try { notifier.Show(toast); live.emplace(tag, Live{toast, token, generation}); } catch (...) { toast.Dismissed(token); throw; }
    }
  }
};
REACT_MODULE(SparkNotifications, L"NativeDesktopNotifications")
struct SparkNotifications {
  std::shared_ptr<NotificationsState> state = std::make_shared<NotificationsState>();
  REACT_INIT(Initialize) void Initialize(React::ReactContext const &context) noexcept { state->context = context; }
  ~SparkNotifications() { auto value = state; if (value->context) value->context.UIDispatcher().Post([value]() { value->Close(); }); }
  REACT_METHOD(call) void call(std::string method, std::string encoded, React::ReactPromise<std::string> promise) noexcept {
    auto value = state; value->context.UIDispatcher().Post([value, method, encoded, promise]() {
      try {
        value->Ensure(); auto args = Json::JsonObject::Parse(to_hstring(encoded));
        if (method == "permission" || method == "requestPermission") { promise.Resolve(value->notifier.Setting() == Toast::NotificationSetting::Enabled ? "\"authorized\"" : "\"denied\""); return; }
        if (method == "show") value->Show(args);
        else if (method == "cancel") value->RemovePending(Hash(args.GetNamedString(L"id")));
        else if (method == "dismiss") { auto tag = Hash(args.GetNamedString(L"id")); value->Forget(tag); Toast::ToastNotificationManager::History().Remove(tag, value->group, value->appId); }
        else if (method == "cancelAll") value->RemovePending(L"");
        else if (method == "dismissAll") { value->Close(); Toast::ToastNotificationManager::History().RemoveGroup(value->group, value->appId); }
        else if (method == "pending" || method == "delivered") {
          Json::JsonArray result;
          if (method == "pending") { for (auto const &item : value->notifier.GetScheduledToastNotifications()) if (item.Group() == value->group) result.Append(Json::JsonValue::CreateStringValue(value->Id(item.Content()))); }
          else { for (auto const &item : Toast::ToastNotificationManager::History().GetHistory(value->appId)) if (item.Group() == value->group) result.Append(Json::JsonValue::CreateStringValue(value->Id(item.Content()))); }
          promise.Resolve(to_string(result.Stringify())); return;
        } else throw hresult_invalid_argument(L"Unsupported notification operation");
        promise.Resolve("null");
      } catch (hresult_error const &error) { promise.Reject(React::ReactError{error.code() == E_ACCESSDENIED ? "E_PERMISSION_DENIED" : "E_NATIVE", to_string(error.message())}); }
      catch (std::exception const &error) { promise.Reject(React::ReactError{"E_NATIVE", error.what()}); }
    });
  }
};
}
