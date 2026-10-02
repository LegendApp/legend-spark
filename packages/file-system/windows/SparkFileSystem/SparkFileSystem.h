#pragma once
#include "NativeModules.h"
#include <SparkBinaryWindows.hpp>
#include <shlobj.h>
#include <shlwapi.h>
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
    case ERROR_INVALID_HANDLE: return "E_CLOSED";
    case ERROR_INVALID_PARAMETER: case ERROR_INVALID_NAME: return "E_INVALID_ARGUMENT";
    default: return "E_IO";
  }
}
template <class Promise> inline void Reject(Promise const &promise) noexcept {
  try { throw; }
  catch (fs::filesystem_error const &e) {
    auto code = e.code(); std::string kind = "E_IO";
    if (code == std::errc::no_such_file_or_directory) kind = "E_NOT_FOUND";
    else if (code == std::errc::permission_denied) kind = "E_PERMISSION";
    else if (code == std::errc::file_exists) kind = "E_EXISTS";
    else if (code == std::errc::directory_not_empty) kind = "E_NOT_EMPTY";
    promise.Reject(React::ReactError{kind, e.what()});
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
      auto destination = fs::symlink_status(to);
      if (destination.type() != fs::file_type::not_found) {
        if (!args.GetNamedBoolean(L"overwrite", false)) throw hresult_error(HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS));
        // Replace wholesale, like the macOS host: remove the destination first.
        std::error_code ignored;
        if (fs::remove_all(to, ignored) == static_cast<uintmax_t>(-1) || ignored) throw_last_error();
        if (fs::symlink_status(to).type() != fs::file_type::not_found) throw hresult_error(HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS));
      }
      if (method == "copy") fs::copy(path, to, fs::copy_options::recursive | fs::copy_options::copy_symlinks);
      else if (!MoveFileExW(path.c_str(), to.c_str(), MOVEFILE_COPY_ALLOWED | MOVEFILE_WRITE_THROUGH)) {
        if (GetLastError() != ERROR_NOT_SAME_DEVICE || !fs::is_directory(path)) throw_last_error();
        try { fs::copy(path, to, fs::copy_options::recursive | fs::copy_options::copy_symlinks); }
        catch (...) { std::error_code ignored; fs::remove_all(to, ignored); throw; }
        fs::remove_all(path);
      }
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
      if (method == "reveal") {
        queue->context.UIDispatcher().Post([encoded, promise = spark::binary::NativePromise(finish)] {
          PIDLIST_ABSOLUTE item = nullptr;
          try { auto path = FilePath(Json::JsonObject::Parse(to_hstring(encoded)).GetNamedString(L"path")); check_hresult(SHParseDisplayName(path.c_str(), nullptr, &item, 0, nullptr)); auto result = SHOpenFolderAndSelectItems(item, 0, nullptr, 0); CoTaskMemFree(item); item = nullptr; check_hresult(result); promise.Resolve("null"); }
          catch (...) { if (item) CoTaskMemFree(item); Reject(promise); }
        }); return;
      }
      queue->Post([queue, method = std::move(method), encoded = std::move(encoded), bytes = std::move(bytes), promise = spark::binary::NativePromise(finish)] {
        try { std::vector<uint8_t> output; auto result = queue->Call(method, Json::JsonObject::Parse(to_hstring(encoded)), bytes, &output); spark::binary::Response response{to_string(result.Stringify()), {}, {}}; if (method == "readBytes" || method == "readChunk") response.bytes = std::make_shared<spark::binary::Bytes>(std::move(output)); promise.Resolve(std::move(response)); }
        catch (...) { Reject(promise); }
      });
    });
      return std::nullopt;
    } catch (std::exception const &error) { return error.what(); }
    catch (hresult_error const &error) { return to_string(error.message()); }
    catch (...) { return "Could not install native binary transport"; }
  }

  REACT_METHOD(call) void call(std::string method, std::string args, React::ReactPromise<std::string> promise) noexcept {
    if (method == "reveal") {
      context.UIDispatcher().Post([args, promise] {
        PIDLIST_ABSOLUTE item = nullptr;
        try {
          auto path = FilePath(Json::JsonObject::Parse(to_hstring(args)).GetNamedString(L"path"));
          check_hresult(SHParseDisplayName(path.c_str(), nullptr, &item, 0, nullptr));
          auto result = SHOpenFolderAndSelectItems(item, 0, nullptr, 0);
          CoTaskMemFree(item); item = nullptr; check_hresult(result); promise.Resolve("null");
        } catch (...) { if (item) CoTaskMemFree(item); Reject(promise); }
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
