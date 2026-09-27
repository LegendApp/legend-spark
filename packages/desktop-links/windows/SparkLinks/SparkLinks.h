#pragma once
#include "../../common/AuthLoopback.h"
#include <map>
#include <memory>
#include <cmath>
#include "NativeModules.h"
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#pragma comment(lib, "Shlwapi.lib")
#include <shobjidl.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <winrt/Windows.Security.Cryptography.Core.h>
#pragma comment(lib, "Shell32.lib")
#pragma comment(lib, "Advapi32.lib")
#include <winrt/Windows.System.h>
#include <winrt/Windows.Data.Json.h>
namespace winrt::SparkLinks {
namespace React = Microsoft::ReactNative;
namespace Json = Windows::Data::Json;
inline std::wstring ProjectAppId() {
  DWORD size = GetEnvironmentVariableW(L"SPARK_PROJECT_ID", nullptr, 0);
  if (!size) throw hresult_invalid_argument(L"Missing project identity");
  std::wstring identity(size, L'\0'); identity.resize(GetEnvironmentVariableW(L"SPARK_PROJECT_ID", identity.data(), size));
  using namespace Windows::Security::Cryptography;
  auto hash = Core::HashAlgorithmProvider::OpenAlgorithm(Core::HashAlgorithmNames::Sha256());
  return L"Spark." + std::wstring(CryptographicBuffer::EncodeToHexString(hash.HashData(CryptographicBuffer::ConvertStringToBinary(identity, BinaryStringEncoding::Utf8))));
}
struct RecentDocuments {
  HKEY key = nullptr;
  std::wstring appId = ProjectAppId();
  RecentDocuments() { check_win32(RegCreateKeyExW(HKEY_CURRENT_USER, (L"Software\\Spark\\" + appId + L"\\RecentDocuments").c_str(), 0, nullptr, 0, KEY_READ | KEY_WRITE, nullptr, &key, nullptr)); }
  ~RecentDocuments() { if (key) RegCloseKey(key); }
  static void check_win32(LSTATUS status) { if (status != ERROR_SUCCESS) throw hresult_error(HRESULT_FROM_WIN32(status)); }
  Json::JsonArray Read() {
    DWORD size = 0; auto status = RegGetValueW(key, nullptr, L"URLs", RRF_RT_REG_SZ, nullptr, nullptr, &size);
    if (status == ERROR_FILE_NOT_FOUND) return {};
    check_win32(status);
    std::wstring value(size / sizeof(wchar_t), L'\0'); check_win32(RegGetValueW(key, nullptr, L"URLs", RRF_RT_REG_SZ, nullptr, value.data(), &size));
    return Json::JsonArray::Parse(value.c_str());
  }
  void Write(Json::JsonArray const &list) { auto value = list.Stringify(); check_win32(RegSetValueExW(key, L"URLs", 0, REG_SZ, reinterpret_cast<BYTE const *>(value.c_str()), static_cast<DWORD>((value.size() + 1) * sizeof(wchar_t)))); }
  bool ShellEnabled() { wchar_t mode[16]{}; GetEnvironmentVariableW(L"SPARK_RUNTIME_MODE", mode, 16); return std::wstring(mode) == L"dev"; }
  static std::wstring Path(hstring const &url) {
    DWORD size = 32768; std::wstring path(size, L'\0'); check_hresult(PathCreateFromUrlW(url.c_str(), path.data(), &size, 0)); path.resize(wcslen(path.c_str())); return path;
  }
  Json::JsonArray Paths() { Json::JsonArray paths; for (auto const &entry : Read()) paths.Append(Json::JsonValue::CreateStringValue(Path(entry.GetString()))); return paths; }
  void Add(hstring const &path) {
    DWORD size = 32768; std::wstring url(size, L'\0'); check_hresult(UrlCreateFromPathW(path.c_str(), url.data(), &size, 0)); url.resize(wcslen(url.c_str()));
    Windows::Foundation::Uri uri(url);
    if (uri.SchemeName() != L"file") throw hresult_invalid_argument(L"Recent documents require file URLs");
    Json::JsonArray next; next.Append(Json::JsonValue::CreateStringValue(uri.AbsoluteUri()));
    for (auto const &entry : Read()) if (entry.GetString() != uri.AbsoluteUri() && next.Size() < 20) next.Append(entry);
    if (ShellEnabled()) {
      com_ptr<IShellItem> item; check_hresult(SHCreateItemFromParsingName(path.c_str(), nullptr, IID_PPV_ARGS(item.put())));
      SHARDAPPIDINFO info{item.get(), appId.c_str()}; SHAddToRecentDocs(SHARD_APPIDINFO, &info);
    }
    Write(next);
  }
  void Clear() {
    if (ShellEnabled()) {
      auto destinations = create_instance<IApplicationDestinations>(CLSID_ApplicationDestinations);
      check_hresult(destinations->SetAppID(appId.c_str())); check_hresult(destinations->RemoveAllDestinations());
    }
    Write(Json::JsonArray());
  }
};
REACT_MODULE(SparkLinks, L"NativeDesktopLinks")
struct SparkLinks {
  using Receivers = std::map<std::string, std::unique_ptr<spark::AuthLoopback>>;
  std::shared_ptr<Receivers> receivers = std::make_shared<Receivers>();
  React::ReactContext context;
  REACT_INIT(Initialize)
  void Initialize(React::ReactContext const &value) noexcept { context = value; }
  static fire_and_forget Invoke(std::shared_ptr<Receivers> receivers, std::string method, std::string encoded, React::ReactPromise<std::string> promise) {
    try {
      auto args = Json::JsonObject::Parse(to_hstring(encoded));
      if (method == "cryptoRandom") {
        auto count = args.GetNamedNumber(L"count"); if (count < 1 || count > 1024 || count != std::floor(count)) throw hresult_invalid_argument(L"Random byte count must be 1–1024");
        auto bytes = Windows::Security::Cryptography::CryptographicBuffer::GenerateRandom(static_cast<uint32_t>(count));
        promise.Resolve(to_string(Json::JsonValue::CreateStringValue(Windows::Security::Cryptography::CryptographicBuffer::EncodeToBase64String(bytes)).Stringify()));
      } else if (method == "cryptoDigest") {
        using namespace Windows::Security::Cryptography;
        auto data = CryptographicBuffer::ConvertStringToBinary(args.GetNamedString(L"value"), BinaryStringEncoding::Utf8);
        if (data.Length() > 1048576) throw hresult_invalid_argument(L"Digest input exceeds 1 MiB");
        auto digest = Core::HashAlgorithmProvider::OpenAlgorithm(Core::HashAlgorithmNames::Sha256()).HashData(data);
        promise.Resolve(to_string(Json::JsonValue::CreateStringValue(CryptographicBuffer::EncodeToHexString(digest)).Stringify()));
      } else if (method.starts_with("auth")) {
        auto id = to_string(args.GetNamedString(L"id"));
        if (method == "authPrepare") {
          if (id.empty() || receivers->count(id) || receivers->size() >= 4) throw hresult_invalid_argument(L"Invalid or busy auth session");
          auto port = args.GetNamedNumber(L"port"); if (port < 0 || port > 65535 || port != std::floor(port)) throw hresult_invalid_argument(L"Invalid callback port");
          auto receiver = std::make_unique<spark::AuthLoopback>(static_cast<unsigned short>(port), to_string(args.GetNamedString(L"path")));
          auto uri = receiver->RedirectURI(); receivers->emplace(id, std::move(receiver)); promise.Resolve(to_string(Json::JsonValue::CreateStringValue(to_hstring(uri)).Stringify()));
        } else if (method == "authClose") { receivers->erase(id); promise.Resolve("null"); }
        else if (method == "authPoll") {
          auto found = receivers->find(id); if (found == receivers->end()) throw hresult_invalid_argument(L"Auth session is closed");
          Json::JsonArray urls; for (auto const &uri : found->second->Drain()) urls.Append(Json::JsonValue::CreateStringValue(to_hstring(uri))); promise.Resolve(to_string(urls.Stringify()));
        } else throw hresult_invalid_argument(L"Unknown auth operation");
      } else if (method == "recent" || method == "noteRecent" || method == "clearRecent") {
        RecentDocuments recent;
        if (method == "recent") promise.Resolve(to_string(recent.Paths().Stringify()));
        else { if (method == "noteRecent") recent.Add(args.GetNamedString(L"path")); else recent.Clear(); promise.Resolve("null"); }
      } else if (method == "openPath") {
        auto path = args.GetNamedString(L"path");
        auto result = reinterpret_cast<INT_PTR>(ShellExecuteW(nullptr, L"open", path.c_str(), nullptr, nullptr, SW_SHOWNORMAL));
        if (result <= 32) { promise.Reject(React::ReactError{result == SE_ERR_FNF || result == SE_ERR_PNF ? "E_NOT_FOUND" : result == SE_ERR_ACCESSDENIED ? "E_PERMISSION_DENIED" : "E_NATIVE", "No application opened this path"}); co_return; }
        promise.Resolve("null");
      } else {
        Windows::Foundation::Uri uri(args.GetNamedString(L"url"));
        if (method == "open") {
          if (!co_await Windows::System::Launcher::LaunchUriAsync(uri)) { promise.Reject(React::ReactError{"E_OPEN_URL", "No application opened this URL"}); co_return; }
          promise.Resolve("null");
        } else if (method == "canOpen") {
          auto status = co_await Windows::System::Launcher::QueryUriSupportAsync(uri, Windows::System::LaunchQuerySupportType::Uri);
          promise.Resolve(status == Windows::System::LaunchQuerySupportStatus::Available ? "true" : "false");
        } else promise.Reject(React::ReactError{"E_UNSUPPORTED", "Unsupported Windows linking operation"});
      }
    } catch (std::exception const &error) { promise.Reject(React::ReactError{"E_AUTH", error.what()}); }
    catch (hresult_error const &error) { promise.Reject(React::ReactError{"E_LINKING", to_string(error.message())}); }
  }
  REACT_METHOD(call)
  void call(std::string method, std::string args, React::ReactPromise<std::string> promise) noexcept {
    context.UIDispatcher().Post([receivers = receivers, method = std::move(method), args = std::move(args), promise]() { Invoke(receivers, method, args, promise); });
  }
};
}
