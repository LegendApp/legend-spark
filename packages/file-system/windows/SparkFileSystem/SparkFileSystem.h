#pragma once
#include "NativeModules.h"
#include <SparkBinaryWindows.hpp>
#include <shlobj.h>
#include <shlwapi.h>
#include <wincodec.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Storage.Streams.h>
#include <filesystem>
#include <algorithm>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <deque>
#include <functional>
#include <map>
#include <vector>
#include <algorithm>
#include <climits>
#include <cmath>
#include "Trash.h"
#pragma comment(lib, "Ole32.lib")
#pragma comment(lib, "Shell32.lib")
#pragma comment(lib, "Shlwapi.lib")
#pragma comment(lib, "Windowscodecs.lib")
#pragma comment(lib, "Gdi32.lib")

namespace winrt::SparkFileSystem {
namespace React = Microsoft::ReactNative;
namespace Json = Windows::Data::Json;
namespace fs = std::filesystem;

inline fs::path FilePath(hstring const &input) {
  std::wstring value(input);
  if (value.empty() || value.find(L'\0') != std::wstring::npos) throw hresult_invalid_argument(L"Expected an absolute path or file URL");
  if (value.starts_with(L"file://")) {
    Windows::Foundation::Uri uri(input);
    if ((!uri.Host().empty() && uri.Host() != L"localhost") || !uri.Query().empty() || !uri.Fragment().empty())
      throw hresult_invalid_argument(L"Expected a local file URL without a query or fragment");
    std::vector<wchar_t> decoded(32768); DWORD length = static_cast<DWORD>(decoded.size());
    check_hresult(PathCreateFromUrlW(value.c_str(), decoded.data(), &length, 0)); value.assign(decoded.data());
  }
  // Device namespaces are not ordinary filesystem paths. Extended drive/UNC paths are supported.
  if (value.starts_with(L"\\\\.\\") || (value.starts_with(L"\\\\?\\") &&
      !(value.size() > 6 && value[5] == L':' && value[6] == L'\\') && !value.starts_with(L"\\\\?\\UNC\\")))
    throw hresult_invalid_argument(L"Expected a filesystem path");
  fs::path result(value);
  if (!result.is_absolute()) throw hresult_invalid_argument(L"Expected an absolute path");
  return result;
}
inline std::string PathString(fs::path const &path) { return to_string(path.wstring()); }
inline std::string ErrorCode(DWORD error) {
  switch (error) {
    case ERROR_FILE_NOT_FOUND: case ERROR_PATH_NOT_FOUND: return "E_NOT_FOUND";
    case ERROR_ACCESS_DENIED: case ERROR_PRIVILEGE_NOT_HELD: return "E_PERMISSION";
    case ERROR_ALREADY_EXISTS: case ERROR_FILE_EXISTS: return "E_EXISTS";
    case ERROR_DIR_NOT_EMPTY: return "E_NOT_EMPTY";
    case ERROR_WRITE_PROTECT: return "E_READ_ONLY";
    case ERROR_DISK_FULL: case ERROR_HANDLE_DISK_FULL: case ERROR_DISK_QUOTA_EXCEEDED: return "E_NO_SPACE";
    case ERROR_INVALID_HANDLE: return "E_CLOSED";
    case ERROR_INVALID_PARAMETER: case ERROR_INVALID_NAME: return "E_INVALID_ARGUMENT";
    default: return "E_IO";
  }
}
// A failure whose Spark code is chosen explicitly rather than mapped from an OS error.
struct CodedError : std::runtime_error {
  std::string code;
  CodedError(std::string value, std::string const &message) : std::runtime_error(message), code(std::move(value)) {}
};
template <class Promise> inline void Reject(Promise const &promise) noexcept {
  try { throw; }
  catch (fs::filesystem_error const &e) {
    auto code = e.code(); std::string kind = "E_IO";
    if (code == std::errc::no_such_file_or_directory) kind = "E_NOT_FOUND";
    else if (code == std::errc::permission_denied) kind = "E_PERMISSION";
    else if (code == std::errc::file_exists) kind = "E_EXISTS";
    else if (code == std::errc::directory_not_empty) kind = "E_NOT_EMPTY";
    else if (code == std::errc::read_only_file_system) kind = "E_READ_ONLY";
    else if (code == std::errc::no_space_on_device) kind = "E_NO_SPACE";
    promise.Reject(React::ReactError{kind, e.what()});
  } catch (CodedError const &e) { promise.Reject(React::ReactError{e.code, e.what()});
  } catch (hresult_error const &e) {
    promise.Reject(React::ReactError{e.code() == E_INVALIDARG ? "E_INVALID_ARGUMENT" : ErrorCode(HRESULT_CODE(e.code())), to_string(e.message())});
  } catch (std::exception const &e) { promise.Reject(React::ReactError{"E_IO", e.what()}); }
  catch (...) { promise.Reject(React::ReactError{"E_IO", "Filesystem operation failed"}); }
}
inline handle Open(fs::path const &path, DWORD access, DWORD creation, DWORD flags = FILE_ATTRIBUTE_NORMAL) {
  auto raw = CreateFileW(path.c_str(), access, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, creation, flags, nullptr);
  if (raw == INVALID_HANDLE_VALUE) throw_last_error();
  return handle(raw);
}
inline std::vector<uint8_t> Read(fs::path const &path) {
  auto file = Open(path, GENERIC_READ, OPEN_EXISTING);
  std::vector<uint8_t> data; uint8_t buffer[65536]; DWORD count;
  do {
    if (!ReadFile(file.get(), buffer, sizeof(buffer), &count, nullptr)) throw_last_error();
    data.insert(data.end(), buffer, buffer + count);
  } while (count);
  return data;
}
inline void Write(fs::path const &path, std::vector<uint8_t> const &data) {
  GUID guid{}; check_hresult(CoCreateGuid(&guid)); wchar_t id[40]{}; StringFromGUID2(guid, id, 40);
  auto temporary = path.parent_path() / (std::wstring(L".spark-") + id);
  try {
    auto file = Open(temporary, GENERIC_WRITE, CREATE_NEW);
    for (size_t offset = 0; offset < data.size();) {
      DWORD count = 0, requested = static_cast<DWORD>((std::min)(data.size() - offset, size_t(65536)));
      if (!WriteFile(file.get(), data.data() + offset, requested, &count, nullptr) || !count) throw_last_error();
      offset += count;
    }
    if (!FlushFileBuffers(file.get())) throw_last_error(); file.close();
    if (!MoveFileExW(temporary.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) throw_last_error();
  } catch (...) { std::error_code ignored; fs::remove(temporary, ignored); throw; }
}
inline bool PathContains(fs::path const &parent, fs::path const &child) {
  auto p = parent.begin(), c = child.begin();
  for (; p != parent.end() && c != child.end() && CompareStringOrdinal(p->c_str(), -1, c->c_str(), -1, TRUE) == CSTR_EQUAL; ++p, ++c) {}
  return p == parent.end();
}
inline void Transfer(fs::path const &from, fs::path const &to, bool move, bool overwrite) {
  auto source = fs::weakly_canonical(from), destination = fs::weakly_canonical(to);
  std::error_code identityError;
  bool sameFile = fs::equivalent(from, to, identityError);
  if (identityError && identityError != std::errc::no_such_file_or_directory) throw fs::filesystem_error("Could not compare transfer paths", from, to, identityError);
  if (sameFile || PathContains(source, destination) || PathContains(destination, source))
    throw hresult_invalid_argument(L"Source and destination identify or contain one another");
  bool destinationExists = fs::symlink_status(to).type() != fs::file_type::not_found;
  if (destinationExists && !overwrite) throw fs::filesystem_error("Destination already exists", to, std::make_error_code(std::errc::file_exists));
  GUID guid{}; check_hresult(CoCreateGuid(&guid)); wchar_t identifier[40]{}; StringFromGUID2(guid, identifier, 40);
  auto stage = to.parent_path() / (std::wstring(L".spark-stage-") + identifier);
  auto backup = to.parent_path() / (std::wstring(L".spark-backup-") + identifier);
  bool stagedByRename = false;
  try {
    wchar_t sourceVolume[32768]{}, destinationVolume[32768]{};
    bool sameVolumeMove = move && GetVolumePathNameW(from.parent_path().c_str(), sourceVolume, ARRAYSIZE(sourceVolume)) &&
      GetVolumePathNameW(to.parent_path().c_str(), destinationVolume, ARRAYSIZE(destinationVolume)) &&
      _wcsicmp(sourceVolume, destinationVolume) == 0;
    if (sameVolumeMove) { fs::rename(from, stage); stagedByRename = true; }
    else fs::copy(from, stage, fs::copy_options::recursive | fs::copy_options::copy_symlinks);
    if (destinationExists && !MoveFileExW(to.c_str(), backup.c_str(), MOVEFILE_WRITE_THROUGH)) {
      auto failure = GetLastError();
      bool restoredSource = !stagedByRename || MoveFileExW(stage.c_str(), from.c_str(), MOVEFILE_WRITE_THROUGH);
      if (!restoredSource) throw hresult_error(HRESULT_FROM_WIN32(ERROR_WRITE_FAULT), L"Destination staging failed and source rollback failed; recoverable source: " + stage.wstring());
      throw hresult_error(HRESULT_FROM_WIN32(failure));
    }
    if (!MoveFileExW(stage.c_str(), to.c_str(), MOVEFILE_WRITE_THROUGH)) {
      auto failure = GetLastError();
      bool restoredDestination = !destinationExists || MoveFileExW(backup.c_str(), to.c_str(), MOVEFILE_WRITE_THROUGH);
      bool restoredSource = !stagedByRename || MoveFileExW(stage.c_str(), from.c_str(), MOVEFILE_WRITE_THROUGH);
      if (!restoredDestination || !restoredSource)
        throw hresult_error(HRESULT_FROM_WIN32(ERROR_WRITE_FAULT), L"Publication and rollback failed; recoverable paths: " + stage.wstring() + L"; " + backup.wstring());
      throw hresult_error(HRESULT_FROM_WIN32(failure));
    }
    if (move && !stagedByRename) {
      std::error_code sourceError; fs::remove_all(from, sourceError);
      if (sourceError) throw fs::filesystem_error("Source cleanup failed after publishing " + PathString(to) + "; source may be partially removed; previous destination is retained at " + PathString(backup), from, sourceError);
    }
    if (destinationExists) {
      std::error_code cleanupError; fs::remove_all(backup, cleanupError);
      if (cleanupError) throw fs::filesystem_error("Transfer committed at " + PathString(to) + "; previous destination cleanup failed; recoverable backup: " + PathString(backup), backup, cleanupError);
    }
  } catch (...) {
    if (!stagedByRename) { std::error_code ignored; fs::remove_all(stage, ignored); }
    throw;
  }
}
inline void RequireExisting(fs::path const &path) {
  if (fs::symlink_status(path).type() == fs::file_type::not_found) throw fs::filesystem_error("No such file or directory", path, std::make_error_code(std::errc::no_such_file_or_directory));
}
// Mark of the Web lives in the Zone.Identifier alternate data stream.
inline fs::path ZoneStream(fs::path const &path) { return fs::path(path.wstring() + L":Zone.Identifier"); }
inline Json::IJsonValue GetQuarantine(fs::path const &path) {
  RequireExisting(path);
  std::vector<uint8_t> bytes;
  try { bytes = Read(ZoneStream(path)); }
  catch (hresult_error const &e) { if (HRESULT_CODE(e.code()) == ERROR_FILE_NOT_FOUND) return Json::JsonValue::CreateNullValue(); throw; }
  std::string text(bytes.begin(), bytes.end()), line; Json::JsonObject result; int zone = -1;
  for (size_t start = 0; start <= text.size();) {
    auto end = text.find('\n', start); line = text.substr(start, end == std::string::npos ? std::string::npos : end - start);
    if (!line.empty() && line.back() == '\r') line.pop_back();
    auto equals = line.find('=');
    if (equals != std::string::npos) {
      auto key = line.substr(0, equals), value = line.substr(equals + 1);
      if (key == "ZoneId") zone = std::atoi(value.c_str());
      else if (key == "ReferrerUrl") result.SetNamedValue(L"originURL", Json::JsonValue::CreateStringValue(to_hstring(value)));
      else if (key == "HostUrl") result.SetNamedValue(L"dataURL", Json::JsonValue::CreateStringValue(to_hstring(value)));
    }
    if (end == std::string::npos) break; start = end + 1;
  }
  // Zones below Internet (3) do not mark content as downloaded from an untrusted source.
  if (zone < 3) return Json::JsonValue::CreateNullValue();
  return result;
}
inline void SetQuarantine(fs::path const &path, Json::JsonObject const &info) {
  RequireExisting(path);
  if (info.HasKey(L"agentName") || info.HasKey(L"timestamp")) throw hresult_invalid_argument(L"Windows Mark of the Web records no agentName or timestamp");
  std::string text = "[ZoneTransfer]\r\nZoneId=3\r\n";
  for (auto [key, name] : { std::pair{L"originURL", "ReferrerUrl"}, std::pair{L"dataURL", "HostUrl"} }) {
    if (!info.HasKey(key)) continue;
    auto value = to_string(info.GetNamedString(key));
    if (value.find_first_of("\r\n") != std::string::npos) throw hresult_invalid_argument(L"Quarantine URLs cannot contain line breaks");
    text += std::string(name) + "=" + value + "\r\n";
  }
  auto stream = Open(ZoneStream(path), GENERIC_WRITE, CREATE_ALWAYS);
  DWORD count = 0;
  if (!WriteFile(stream.get(), text.data(), static_cast<DWORD>(text.size()), &count, nullptr) || count != text.size()) throw_last_error();
}
inline void ClearQuarantine(fs::path const &path) {
  RequireExisting(path);
  if (!DeleteFileW(ZoneStream(path).c_str()) && GetLastError() != ERROR_FILE_NOT_FOUND) throw_last_error();
}
inline int ImageSize(Json::JsonObject const &args) {
  auto size = args.GetNamedNumber(L"size");
  if (!std::isfinite(size) || size < 1 || size > 1024 || std::floor(size) != size) throw hresult_invalid_argument(L"Image size must be an integer from 1 to 1024");
  return static_cast<int>(size);
}
// The shell's icon or thumbnail, fitted within size and encoded as PNG. SIIGBF_THUMBNAILONLY fails
// instead of substituting the icon when no thumbnail provider handles the file.
inline std::vector<uint8_t> ShellImage(fs::path const &path, int size, bool thumbnail) {
  RequireExisting(path);
  com_ptr<IShellItemImageFactory> factory;
  check_hresult(SHCreateItemFromParsingName(path.c_str(), nullptr, IID_PPV_ARGS(factory.put())));
  HBITMAP bitmap = nullptr;
  auto result = factory->GetImage(SIZE{size, size}, thumbnail ? SIIGBF_THUMBNAILONLY : SIIGBF_ICONONLY, &bitmap);
  if (FAILED(result)) {
    if (thumbnail) throw CodedError("E_UNAVAILABLE", "No thumbnail is available for this file");
    throw_hresult(result);
  }
  std::unique_ptr<std::remove_pointer_t<HBITMAP>, decltype(&DeleteObject)> owned(bitmap, &DeleteObject);
  // Opaque thumbnails can arrive with an all-zero alpha channel; treat those as opaque.
  DIBSECTION dib{}; bool alpha = false;
  if (GetObjectW(bitmap, sizeof dib, &dib) == sizeof dib && dib.dsBm.bmBitsPixel == 32 && dib.dsBm.bmBits) {
    auto pixels = static_cast<uint8_t const *>(dib.dsBm.bmBits);
    for (LONG i = 3, end = dib.dsBm.bmWidthBytes * dib.dsBm.bmHeight; i < end && !alpha; i += 4) alpha = pixels[i] != 0;
  }
  auto wic = create_instance<IWICImagingFactory>(CLSID_WICImagingFactory);
  com_ptr<IWICBitmap> source;
  check_hresult(wic->CreateBitmapFromHBITMAP(bitmap, nullptr, alpha ? WICBitmapUsePremultipliedAlpha : WICBitmapIgnoreAlpha, source.put()));
  com_ptr<IStream> stream; stream.attach(SHCreateMemStream(nullptr, 0));
  if (!stream) throw hresult_error(E_OUTOFMEMORY);
  com_ptr<IWICBitmapEncoder> encoder; com_ptr<IWICBitmapFrameEncode> frame;
  check_hresult(wic->CreateEncoder(GUID_ContainerFormatPng, nullptr, encoder.put()));
  check_hresult(encoder->Initialize(stream.get(), WICBitmapEncoderNoCache));
  check_hresult(encoder->CreateNewFrame(frame.put(), nullptr));
  check_hresult(frame->Initialize(nullptr));
  UINT width = 0, height = 0; check_hresult(source->GetSize(&width, &height));
  check_hresult(frame->SetSize(width, height));
  WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
  check_hresult(frame->SetPixelFormat(&format));
  check_hresult(frame->WriteSource(source.get(), nullptr));
  check_hresult(frame->Commit()); check_hresult(encoder->Commit());
  ULARGE_INTEGER length{}; check_hresult(IStream_Size(stream.get(), &length)); check_hresult(IStream_Reset(stream.get()));
  std::vector<uint8_t> png(static_cast<size_t>(length.QuadPart));
  check_hresult(IStream_Read(stream.get(), png.data(), static_cast<ULONG>(png.size())));
  return png;
}
inline Json::IJsonValue DiskSpace(fs::path const &path) {
  RequireExisting(path);
  auto directory = fs::is_directory(path) ? path : path.parent_path();
  ULARGE_INTEGER available{}, total{}, free{};
  if (!GetDiskFreeSpaceExW(directory.c_str(), &available, &total, &free)) throw_last_error();
  Json::JsonObject result;
  result.SetNamedValue(L"totalBytes", Json::JsonValue::CreateNumberValue(static_cast<double>(total.QuadPart)));
  result.SetNamedValue(L"availableBytes", Json::JsonValue::CreateNumberValue(static_cast<double>(available.QuadPart)));
  return result;
}
// Registered handlers for the file's extension. Name is the handler's executable path.
template <class Visit> inline void EachHandler(fs::path const &path, Visit visit) {
  RequireExisting(path);
  auto extension = path.extension().wstring();
  if (extension.empty()) return;
  com_ptr<IEnumAssocHandlers> handlers;
  check_hresult(SHAssocEnumHandlers(extension.c_str(), ASSOC_FILTER_RECOMMENDED, handlers.put()));
  for (;;) {
    com_ptr<IAssocHandler> handler; ULONG fetched = 0;
    if (handlers->Next(1, handler.put(), &fetched) != S_OK || !fetched) break;
    PWSTR name = nullptr, label = nullptr;
    if (FAILED(handler->GetName(&name))) continue;
    std::wstring executable(name); CoTaskMemFree(name);
    std::wstring display = SUCCEEDED(handler->GetUIName(&label)) ? std::wstring(label) : fs::path(executable).stem().wstring();
    if (label) CoTaskMemFree(label);
    if (visit(handler, executable, display)) return;
  }
}
inline Json::IJsonValue Applications(fs::path const &path) {
  wchar_t preferred[MAX_PATH]{}; DWORD length = MAX_PATH;
  auto extension = path.extension().wstring();
  bool hasDefault = !extension.empty() && SUCCEEDED(AssocQueryStringW(ASSOCF_NOTRUNCATE, ASSOCSTR_EXECUTABLE, extension.c_str(), nullptr, preferred, &length));
  Json::JsonArray result; bool defaultSeen = false; std::vector<std::wstring> seen;
  EachHandler(path, [&](com_ptr<IAssocHandler> const &, std::wstring const &executable, std::wstring const &display) {
    for (auto const &item : seen) if (CompareStringOrdinal(item.c_str(), -1, executable.c_str(), -1, TRUE) == CSTR_EQUAL) return false;
    seen.push_back(executable);
    bool isDefault = hasDefault && !defaultSeen && CompareStringOrdinal(preferred, -1, executable.c_str(), -1, TRUE) == CSTR_EQUAL;
    defaultSeen = defaultSeen || isDefault;
    Json::JsonObject app;
    app.SetNamedValue(L"name", Json::JsonValue::CreateStringValue(display));
    app.SetNamedValue(L"path", Json::JsonValue::CreateStringValue(executable));
    app.SetNamedValue(L"isDefault", Json::JsonValue::CreateBooleanValue(isDefault));
    result.Append(app); return false;
  });
  return result;
}
// Invokes the registered handler; an unregistered application is rejected rather than launched with arguments.
inline void OpenWith(fs::path const &path, fs::path const &application) {
  bool opened = false;
  EachHandler(path, [&](com_ptr<IAssocHandler> const &handler, std::wstring const &executable, std::wstring const &) {
    if (CompareStringOrdinal(executable.c_str(), -1, application.c_str(), -1, TRUE) != CSTR_EQUAL) return false;
    com_ptr<IShellItem> item; check_hresult(SHCreateItemFromParsingName(path.c_str(), nullptr, IID_PPV_ARGS(item.put())));
    com_ptr<IDataObject> data; check_hresult(item->BindToHandler(nullptr, BHID_DataObject, IID_PPV_ARGS(data.put())));
    check_hresult(handler->Invoke(data.get())); opened = true; return true;
  });
  if (!opened) throw hresult_error(HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND), L"The application is not registered to open this file");
}
// Shell UI actions run on the UI thread.
inline void RunShellAction(std::string const &method, Json::JsonObject const &args) {
  auto path = FilePath(args.GetNamedString(L"path"));
  if (method == "openWith") { OpenWith(path, FilePath(args.GetNamedString(L"application"))); return; }
  PIDLIST_ABSOLUTE item = nullptr;
  check_hresult(SHParseDisplayName(path.c_str(), nullptr, &item, 0, nullptr));
  auto result = SHOpenFolderAndSelectItems(item, 0, nullptr, 0);
  CoTaskMemFree(item); check_hresult(result);
}
inline fs::path Directory(hstring const &kind) {
  wchar_t identity[201]{}; auto count = GetEnvironmentVariableW(L"SPARK_PROJECT_ID", identity, 201);
  if (!count || count >= 201) throw hresult_invalid_argument(L"Launch through Spark to establish project storage identity");
  // Hex encoding is injective and cannot introduce separators or reserved device names.
  std::wstring project; constexpr wchar_t hex[] = L"0123456789abcdef";
  for (auto byte : to_string(hstring(identity))) { project += hex[(static_cast<unsigned char>(byte) >> 4) & 15]; project += hex[byte & 15]; }
  fs::path base;
  if (kind == L"temp") {
    std::vector<wchar_t> value(32768); auto size = GetTempPathW(static_cast<DWORD>(value.size()), value.data());
    if (!size || size >= value.size()) throw_last_error(); base = value.data();
  } else if (kind == L"data" || kind == L"cache") {
    PWSTR value = nullptr; check_hresult(SHGetKnownFolderPath(FOLDERID_LocalAppData, KF_FLAG_CREATE, nullptr, &value));
    base = value; CoTaskMemFree(value);
  } else throw hresult_invalid_argument(L"Unknown directory kind");
  // Split long identities into components to stay below NTFS's filename limit.
  base /= L"Spark"; for (size_t i = 0; i < project.size(); i += 100) base /= project.substr(i, 100);
  base /= kind.c_str(); fs::create_directories(base); return base;
}

// Invalidation: a file watches its parent so atomic replacement does
// not detach the subscription. Signals may include sibling changes, as on macOS.
struct Watch {
  std::vector<HANDLE> notifications;
  handle stop{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
  std::thread thread;
  Watch(fs::path const &path, std::string id, React::ReactContext context, bool recursive) {
    if (!stop) throw_last_error();
    if (recursive && !fs::is_directory(path)) throw hresult_invalid_argument(L"Recursive watch requires an existing directory");
    const auto observed = fs::is_directory(path) ? path : path.parent_path();
    auto observe = [this](fs::path const &directory, bool subtree) {
      auto handle = FindFirstChangeNotificationW(directory.c_str(), subtree,
        FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_DIR_NAME | FILE_NOTIFY_CHANGE_ATTRIBUTES | FILE_NOTIFY_CHANGE_SIZE | FILE_NOTIFY_CHANGE_LAST_WRITE);
      if (handle == INVALID_HANDLE_VALUE) throw_last_error();
      notifications.push_back(handle);
    };
    try {
      observe(observed, recursive);
      // A directory's own rename/deletion changes its parent, not its contents.
      // Keep that invalidation too; as on macOS, listeners must re-read the path.
      if (observed.has_parent_path() && observed.parent_path() != observed) observe(observed.parent_path(), recursive);
      thread = std::thread([this, id, context, path = PathString(path)] {
        init_apartment(apartment_type::multi_threaded);
        std::vector<HANDLE> signals{stop.get()}; signals.insert(signals.end(), notifications.begin(), notifications.end());
        for (;;) {
          auto result = WaitForMultipleObjects(static_cast<DWORD>(signals.size()), signals.data(), FALSE, INFINITE);
          if (result < WAIT_OBJECT_0 + 1 || result >= WAIT_OBJECT_0 + signals.size()) break;
          const bool rearmed = FindNextChangeNotification(signals[result - WAIT_OBJECT_0]) != FALSE;
          if (WaitForSingleObject(stop.get(), 0) != WAIT_TIMEOUT) break;
          context.EmitJSEvent(L"RCTDeviceEventEmitter", L"change", React::JSValueObject{{"id", id}, {"path", path}});
          if (!rearmed) {
            const auto index = result - WAIT_OBJECT_0;
            auto failed = signals[index]; signals.erase(signals.begin() + index);
            notifications.erase(std::remove(notifications.begin(), notifications.end(), failed), notifications.end());
            FindCloseChangeNotification(failed);
            if (signals.size() == 1) break;
          }
        }
        uninit_apartment();
      });
    } catch (...) { for (auto handle : notifications) FindCloseChangeNotification(handle); throw; }
  }
  ~Watch() { SetEvent(stop.get()); if (thread.joinable()) thread.join(); for (auto handle : notifications) FindCloseChangeNotification(handle); }
};
struct FileQueue {
  React::ReactContext context;
  std::mutex mutex; std::condition_variable ready; bool stopping = false;
  std::deque<std::function<void()>> pending;
  std::map<std::string, std::unique_ptr<Watch>> watches;
  std::map<std::string, handle> files;
  std::thread worker;
  explicit FileQueue(React::ReactContext value) : context(value), worker([this] {
    init_apartment(apartment_type::multi_threaded);
    for (;;) {
      std::function<void()> action;
      { std::unique_lock lock(mutex); ready.wait(lock, [this] { return stopping || !pending.empty(); });
        if (pending.empty()) break; action = std::move(pending.front()); pending.pop_front(); }
      action();
    }
    files.clear(); watches.clear(); uninit_apartment();
  }) {}
  ~FileQueue() { { std::lock_guard lock(mutex); stopping = true; } ready.notify_one(); worker.join(); }
  void Post(std::function<void()> action) { { std::lock_guard lock(mutex); pending.push_back(std::move(action)); } ready.notify_one(); }
  Json::IJsonValue Call(std::string const &method, Json::JsonObject const &args, std::optional<std::vector<uint8_t>> const &input = {}, std::vector<uint8_t> *output = nullptr) {
    if (method == "directory") return Json::JsonValue::CreateStringValue(Directory(args.GetNamedString(L"kind")).wstring());
    if (method == "unwatch") { watches.erase(to_string(args.GetNamedString(L"id"))); return Json::JsonValue::Parse(L"null"); }
    if (method == "closeFile") { files.erase(to_string(args.GetNamedString(L"id"))); return Json::JsonValue::Parse(L"null"); }
    if (method == "readChunk" || method == "writeChunk" || method == "flushFile") {
      auto found = files.find(to_string(args.GetNamedString(L"id")));
      if (found == files.end()) throw hresult_error(HRESULT_FROM_WIN32(ERROR_INVALID_HANDLE), L"Unknown or closed file handle");
      auto file = found->second.get();
      if (method == "flushFile") { if (!FlushFileBuffers(file)) throw_last_error(); return Json::JsonValue::Parse(L"null"); }
      double offset = args.GetNamedNumber(L"offset");
      if (!std::isfinite(offset) || offset < 0 || std::floor(offset) != offset || offset > 9007199254740991.0) throw hresult_invalid_argument(L"Invalid file offset");
      LARGE_INTEGER position{}; position.QuadPart = static_cast<LONGLONG>(offset);
      if (!SetFilePointerEx(file, position, nullptr, FILE_BEGIN)) throw_last_error();
      if (method == "readChunk") {
        double length = args.GetNamedNumber(L"length");
        if (!std::isfinite(length) || length < 1 || length > 1048576 || std::floor(length) != length || offset + length > 9007199254740991.0) throw hresult_invalid_argument(L"Invalid chunk length");
        std::vector<uint8_t> data(static_cast<size_t>(length)); DWORD count = 0;
        if (!ReadFile(file, data.data(), static_cast<DWORD>(data.size()), &count, nullptr)) throw_last_error();
        data.resize(count); if (!output) throw hresult_invalid_argument(L"Expected binary transport"); *output = std::move(data); return Json::JsonValue::CreateNullValue();
      }
      if (!input || input->size() > 1048576 || offset + input->size() > 9007199254740991.0) throw hresult_invalid_argument(L"Invalid chunk");
      auto const &data = *input;
      size_t written = 0;
      while (written < data.size()) { DWORD count = 0; if (!WriteFile(file, data.data() + written, static_cast<DWORD>(data.size() - written), &count, nullptr)) throw_last_error(); if (!count) throw hresult_error(E_FAIL, L"File write made no progress"); written += count; }
      return Json::JsonValue::CreateNumberValue(static_cast<double>(written));
    }
    auto path = FilePath(args.GetNamedString(L"path"));
    if (method == "openFile") {
      auto mode = args.GetNamedString(L"mode"); DWORD access, creation;
      if (mode == L"read") { access = GENERIC_READ; creation = OPEN_EXISTING; }
      else if (mode == L"readWrite") { access = GENERIC_READ | GENERIC_WRITE; creation = OPEN_EXISTING; }
      else if (mode == L"write") { access = GENERIC_WRITE; creation = OPEN_ALWAYS; }
      else if (mode == L"createNew") { access = GENERIC_WRITE; creation = CREATE_NEW; }
      else throw hresult_invalid_argument(L"Invalid file mode");
      auto file = Open(path, access, creation);
      BY_HANDLE_FILE_INFORMATION info{}; if (!GetFileInformationByHandle(file.get(), &info)) throw_last_error();
      if (GetFileType(file.get()) != FILE_TYPE_DISK || (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) throw hresult_invalid_argument(L"Expected a regular file");
      if (mode == L"write" && !SetEndOfFile(file.get())) throw_last_error();
      GUID guid{}; check_hresult(CoCreateGuid(&guid)); wchar_t identifier[40]{}; StringFromGUID2(guid, identifier, 40);
      files.emplace(to_string(hstring(identifier)), std::move(file)); return Json::JsonValue::CreateStringValue(identifier);
    }
    if (method == "trash") { Trash(path); return Json::JsonValue::Parse(L"null"); }
    if (method == "diskSpace") return DiskSpace(path);
    if (method == "icon" || method == "thumbnail") {
      if (!output) throw hresult_invalid_argument(L"Expected binary transport");
      *output = ShellImage(path, ImageSize(args), method == "thumbnail"); return Json::JsonValue::CreateNullValue();
    }
    if (method == "applications") return Applications(path);
    if (method == "getQuarantine") return GetQuarantine(path);
    if (method == "setQuarantine") { SetQuarantine(path, args.GetNamedObject(L"info")); return Json::JsonValue::Parse(L"null"); }
    if (method == "clearQuarantine") { ClearQuarantine(path); return Json::JsonValue::Parse(L"null"); }
    if (method == "readText") {
      const auto bytes = Read(path); std::string text(bytes.begin(), bytes.end());
      if (text.starts_with("\xef\xbb\xbf")) text.erase(0, 3);
      // Reject malformed UTF-8 before WinRT conversion can replace bytes.
      if (text.size() > INT_MAX) throw hresult_error(E_FAIL, L"Text exceeds the UTF-8 conversion limit");
      if (!text.empty() && !MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), nullptr, 0)) throw_last_error();
      return Json::JsonValue::CreateStringValue(to_hstring(text));
    } else if (method == "readBytes") { if (!output) throw hresult_invalid_argument(L"Expected binary transport"); *output = Read(path); return Json::JsonValue::CreateNullValue(); }
    else if (method == "writeTextIfUnchanged") {
      if (Call("readText", args).GetString() != args.GetNamedString(L"expected")) return Json::JsonValue::CreateBooleanValue(false);
      auto text = to_string(args.GetNamedString(L"text")); Write(path, std::vector<uint8_t>(text.begin(), text.end()));
      return Json::JsonValue::CreateBooleanValue(true);
    }
    else if (method == "writeText") { auto text = to_string(args.GetNamedString(L"text")); Write(path, std::vector<uint8_t>(text.begin(), text.end())); }
    else if (method == "writeBytes") {
      if (!input) throw hresult_invalid_argument(L"Expected binary file data"); Write(path, *input);
    } else if (method == "mkdir") {
      if (args.GetNamedBoolean(L"recursive", true)) fs::create_directories(path);
      else if (!fs::create_directory(path)) throw hresult_error(HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS));
    } else if (method == "remove") {
      if (args.GetNamedBoolean(L"recursive", false)) return Json::JsonValue::CreateBooleanValue(fs::remove_all(path) != 0);
      return Json::JsonValue::CreateBooleanValue(fs::remove(path));
    } else if (method == "copy" || method == "move") {
      auto to = FilePath(args.GetNamedString(L"to"));
      Transfer(path, to, method == "move", args.GetNamedBoolean(L"overwrite", false));
    } else if (method == "stat") {
      // OPEN_REPARSE_POINT describes a link itself, including dangling links.
      auto file = Open(path, FILE_READ_ATTRIBUTES, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT);
      BY_HANDLE_FILE_INFORMATION info{}; if (!GetFileInformationByHandle(file.get(), &info)) throw_last_error();
      ULARGE_INTEGER time{}; time.LowPart = info.ftLastWriteTime.dwLowDateTime; time.HighPart = info.ftLastWriteTime.dwHighDateTime;
      Json::JsonObject result;
      result.SetNamedValue(L"type", Json::JsonValue::CreateStringValue(fs::is_symlink(fs::symlink_status(path)) ? L"symlink" : (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) ? L"directory" : L"file"));
      result.SetNamedValue(L"size", Json::JsonValue::CreateNumberValue(static_cast<double>((uint64_t(info.nFileSizeHigh) << 32) | info.nFileSizeLow)));
      result.SetNamedValue(L"modifiedAt", Json::JsonValue::CreateNumberValue(static_cast<double>(time.QuadPart) / 10000.0 - 11644473600000.0)); return result;
    } else if (method == "list") {
      std::vector<std::wstring> names; for (auto const &item : fs::directory_iterator(path)) names.push_back(item.path().filename().wstring());
      std::sort(names.begin(), names.end()); Json::JsonArray result;
      for (auto const &name : names) result.Append(Json::JsonValue::CreateStringValue(name)); return result;
    } else if (method == "watch") {
      auto id = to_string(args.GetNamedString(L"id"));
      if (id.empty() || watches.count(id)) throw hresult_invalid_argument(L"Watch id must be unique and nonempty");
      watches.emplace(id, std::make_unique<Watch>(path, id, context, args.GetNamedBoolean(L"recursive", false)));
    } else throw hresult_invalid_argument(L"Unknown filesystem operation");
    return Json::JsonValue::Parse(L"null");
  }
};
REACT_MODULE(SparkFileSystem, L"NativeDesktopFileSystem")
struct SparkFileSystem {
  React::ReactContext context;
  std::shared_ptr<FileQueue> queue;
  REACT_INIT(Initialize) void Initialize(React::ReactContext const &value) noexcept { context = value; queue = std::make_shared<FileQueue>(context); }
  REACT_SYNC_METHOD(installBinary) std::optional<std::string> installBinary() noexcept {
    try {
    spark::binary::Install(context, "__sparkFileSystemBinary", [queue = queue](std::string method, std::string encoded, std::optional<std::vector<uint8_t>> bytes, spark::binary::Completion finish) {
      if (method == "reveal" || method == "openWith") {
        queue->context.UIDispatcher().Post([method, encoded, promise = spark::binary::NativePromise(finish)] {
          try { RunShellAction(method, Json::JsonObject::Parse(to_hstring(encoded))); promise.Resolve("null"); }
          catch (...) { Reject(promise); }
        }); return;
      }
      queue->Post([queue, method = std::move(method), encoded = std::move(encoded), bytes = std::move(bytes), promise = spark::binary::NativePromise(finish)] {
        try { std::vector<uint8_t> output; auto result = queue->Call(method, Json::JsonObject::Parse(to_hstring(encoded)), bytes, &output); spark::binary::Response response{to_string(result.Stringify()), {}, {}}; if (method == "readBytes" || method == "readChunk" || method == "icon" || method == "thumbnail") response.bytes = std::make_shared<spark::binary::Bytes>(std::move(output)); promise.Resolve(std::move(response)); }
        catch (...) { Reject(promise); }
      });
    });
      return std::nullopt;
    } catch (std::exception const &error) { return error.what(); }
    catch (hresult_error const &error) { return to_string(error.message()); }
    catch (...) { return "Could not install native binary transport"; }
  }

  REACT_METHOD(call) void call(std::string method, std::string args, React::ReactPromise<std::string> promise) noexcept {
    if (method == "reveal" || method == "openWith") {
      context.UIDispatcher().Post([method, args, promise] {
        try { RunShellAction(method, Json::JsonObject::Parse(to_hstring(args))); promise.Resolve("null"); }
        catch (...) { Reject(promise); }
      });
      return;
    }
    queue->Post([state = queue.get(), method, args, promise] {
      try { promise.Resolve(to_string(state->Call(method, Json::JsonObject::Parse(to_hstring(args))).Stringify())); }
      catch (...) { Reject(promise); }
    });
  }
  REACT_METHOD(addListener) void addListener(std::string) noexcept {}
  REACT_METHOD(removeListeners) void removeListeners(double) noexcept {}
};
}
