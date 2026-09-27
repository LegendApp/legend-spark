#pragma once
#include "NativeModules.h"
#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <deque>
#include <filesystem>
#include <future>
#include <fstream>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <thread>
#include <vector>
#include <wincrypt.h>
#include <winrt/Windows.Data.Json.h>
#pragma comment(lib, "Crypt32.lib")
namespace winrt::SparkProcesses {
namespace React = Microsoft::ReactNative;
namespace Json = Windows::Data::Json;
inline std::wstring Quote(std::wstring const &argument) {
  std::wstring result = L"\""; size_t slashes = 0;
  for (auto c : argument) {
    if (c == L'\\') { ++slashes; continue; }
    result.append(c == L'"' ? slashes * 2 + 1 : slashes, L'\\'); slashes = 0; result += c;
  }
  result.append(slashes * 2, L'\\'); result += L'"'; return result;
}
inline std::string Base64(std::string const &bytes) {
  if (bytes.empty()) return "";
  DWORD length = 0; if (!CryptBinaryToStringA(reinterpret_cast<BYTE const *>(bytes.data()), static_cast<DWORD>(bytes.size()), CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, nullptr, &length)) throw_last_error();
  std::string result(length, '\0'); if (!CryptBinaryToStringA(reinterpret_cast<BYTE const *>(bytes.data()), static_cast<DWORD>(bytes.size()), CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, result.data(), &length)) throw_last_error(); result.resize(length); return result;
}
inline std::string DecodeBase64(std::string const &encoded) {
  if (encoded.empty()) return {};
  DWORD length = 0;
  if (!CryptStringToBinaryA(encoded.data(), static_cast<DWORD>(encoded.size()), CRYPT_STRING_BASE64 | CRYPT_STRING_STRICT, nullptr, &length, nullptr, nullptr)) throw hresult_invalid_argument(L"Invalid process input");
  std::string bytes(length, '\0');
  if (!CryptStringToBinaryA(encoded.data(), static_cast<DWORD>(encoded.size()), CRYPT_STRING_BASE64 | CRYPT_STRING_STRICT, reinterpret_cast<BYTE *>(bytes.data()), &length, nullptr, nullptr)) throw hresult_invalid_argument(L"Invalid process input");
  bytes.resize(length); return bytes;
}
inline std::wstring ResolveCommand(std::wstring const &name) {
  if (name.empty() || name.find_first_of(L"/\\:") != std::wstring::npos) throw hresult_invalid_argument(L"Expected a command name");
  DWORD size = GetEnvironmentVariableW(L"PATH", nullptr, 0);
  if (!size) return {};
  std::wstring paths(size, L'\0'); GetEnvironmentVariableW(L"PATH", paths.data(), size);
  std::wstring absolutePaths; size_t start = 0;
  while (start < paths.size()) {
    auto end = paths.find(L';', start); auto directory = paths.substr(start, end == std::wstring::npos ? std::wstring::npos : end - start);
    directory.resize(wcslen(directory.c_str()));
    if (directory.size() >= 2 && directory.front() == L'"' && directory.back() == L'"') directory = directory.substr(1, directory.size() - 2);
    if (std::filesystem::path(directory).is_absolute()) { if (!absolutePaths.empty()) absolutePaths += L';'; absolutePaths += directory; }
    if (end == std::wstring::npos) break; start = end + 1;
  }
  if (absolutePaths.empty()) return {};
  wchar_t result[32768]{};
  DWORD count = SearchPathW(absolutePaths.c_str(), name.c_str(), L".exe", 32768, result, nullptr);
  if (!count) return {};
  if (count >= 32768) throw hresult_invalid_argument(L"Resolved command path is too long");
  auto attributes = GetFileAttributesW(result);
  if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_DIRECTORY)) return {};
  auto extension = std::filesystem::path(result).extension().wstring();
  if (_wcsicmp(extension.c_str(), L".exe") && _wcsicmp(extension.c_str(), L".com")) return {};
  return result;
}
struct Process : std::enable_shared_from_this<Process> {
  struct Input { std::string text; bool close; std::optional<React::ReactPromise<std::string>> promise; };
  handle process, job, input, output, error;
  std::mutex mutex; std::condition_variable condition; std::deque<Input> queue;
  std::atomic<bool> done{false}, terminated{false}, timedOut{false}, truncated{false};
  bool inputClosed = false;
  size_t captureLimit = 8 * 1024 * 1024;
  std::string id, stdoutBytes, stderrBytes;
  React::ReactContext context;
  void StopChecked() { if (job && !TerminateJobObject(job.get(), 1)) throw_last_error(); terminated = true; }
  void Stop() noexcept { terminated = true; if (job) TerminateJobObject(job.get(), 1); }
  void Write(Input value) { std::lock_guard lock(mutex); if (done || inputClosed) { if (value.promise) { if (value.close) value.promise->Resolve("null"); else value.promise->Reject(React::ReactError{"E_CLOSED", "Process input is closed"}); } return; } if (value.close) inputClosed = true; queue.push_back(std::move(value)); condition.notify_one(); }
  void InputLoop() noexcept {
    while (true) {
      Input value;
      { std::unique_lock lock(mutex); condition.wait(lock, [&]() { return done || !queue.empty(); }); if (queue.empty()) break; value = std::move(queue.front()); queue.pop_front(); }
      if (done || !input) { if (value.promise) value.promise->Reject(React::ReactError{"E_CLOSED", "Process input is closed"}); continue; }
      bool success = true;
      if (value.close) input.close();
      else for (size_t offset = 0; offset < value.text.size();) { DWORD written = 0; if (!WriteFile(input.get(), value.text.data() + offset, static_cast<DWORD>(std::min<size_t>(16384, value.text.size() - offset)), &written, nullptr) || !written) { success = false; break; } offset += written; }
      if (value.promise) { if (success) value.promise->Resolve("null"); else value.promise->Reject(React::ReactError{"E_CLOSED", "Process input is closed"}); }
    }
    input.close();
  }
  void Read(HANDLE pipe, std::string &buffer, std::string stream, bool streaming, std::shared_ptr<std::atomic<bool>> active) {
    char bytes[16384]; DWORD count;
    while (ReadFile(pipe, bytes, sizeof(bytes), &count, nullptr) && count) {
      const auto keep = std::min<size_t>(count, captureLimit - buffer.size()); buffer.append(bytes, keep); if (keep < count) truncated = true;
      if (streaming && *active) {
        auto flushed = std::make_shared<std::promise<void>>(); auto wait = flushed->get_future();
        auto data = Base64(std::string(bytes, count)); auto key = id;
        context.UIDispatcher().Post([context = context, active, key, stream, data, flushed]() {
          if (*active) context.EmitJSEvent(L"RCTDeviceEventEmitter", L"desktop", React::JSValueObject{{"type", "processOutput"}, {"processId", key}, {"stream", stream}, {"base64", data}});
          flushed->set_value();
        });
        // Backpressure bounds the JS queue. Runtime shutdown releases this wait.
        while (*active && wait.wait_for(std::chrono::milliseconds(100)) != std::future_status::ready) {}
      }
    }
  }
  static void Pipe(handle &read, handle &write, bool parentReads) {
    SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    if (!CreatePipe(read.put(), write.put(), &security, 0)) throw_last_error();
    if (!SetHandleInformation(parentReads ? read.get() : write.get(), HANDLE_FLAG_INHERIT, 0)) throw_last_error();
  }
  void Start(Json::JsonObject const &args) {
    const auto limit = args.GetNamedNumber(L"captureLimitBytes", 8 * 1024 * 1024);
    if (limit < 0 || limit > 8 * 1024 * 1024) throw hresult_invalid_argument(L"Invalid capture limit");
    captureLimit = static_cast<size_t>(limit);
    const auto initialInput = args.HasKey(L"inputBase64") ? DecodeBase64(to_string(args.GetNamedString(L"inputBase64"))) : std::string{};
    auto executable = std::wstring(args.GetNamedString(L"executable"));
    if (executable.rfind(L"helper:", 0) == 0) {
      const auto name = executable.substr(7); if (name.empty() || name.find_first_not_of(L"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-") != std::wstring::npos) throw hresult_invalid_argument(L"Invalid helper name");
      wchar_t module[32768]{}; GetModuleFileNameW(nullptr, module, 32768);
      const auto helpers = std::filesystem::path(module).parent_path() / L"Helpers";
      const auto bundle = helpers / (name + L".helper");
      executable = (helpers / (name + L".exe")).wstring();
      if (std::filesystem::exists(bundle)) {
        std::ifstream metadata(bundle / L".spark-entry", std::ios::binary);
        std::string entry((std::istreambuf_iterator<char>(metadata)), std::istreambuf_iterator<char>());
        if (entry.empty() || entry.front() == '/' || entry.find_first_of("\\:") != std::string::npos || entry.find('\0') != std::string::npos) throw hresult_invalid_argument(L"Invalid helper bundle entry");
        const auto relative = std::filesystem::path(winrt::to_hstring(entry).c_str());
        for (auto const &part : relative) if (part == L"..") throw hresult_invalid_argument(L"Invalid helper bundle entry");
        executable = (bundle / relative).wstring();
      }
    }
    if (!std::filesystem::path(executable).is_absolute()) throw hresult_invalid_argument(L"Executable must be absolute");
    std::wstring command = Quote(executable); for (auto const &value : args.GetNamedArray(L"args", Json::JsonArray())) { command += L' '; command += Quote(std::wstring(value.GetString())); }
    auto cwd = args.GetNamedString(L"cwd", L"");
    struct Less { bool operator()(std::wstring const &a, std::wstring const &b) const { return _wcsicmp(a.c_str(), b.c_str()) < 0; } };
    std::map<std::wstring, std::wstring, Less> environment;
    auto inherited = GetEnvironmentStringsW(); if (!inherited) throw_last_error();
    for (auto entry = inherited; *entry; entry += wcslen(entry) + 1) { std::wstring value(entry); auto split = value.find(L'=', value[0] == L'=' ? 1 : 0); if (split != std::wstring::npos) environment[value.substr(0, split)] = value.substr(split + 1); } FreeEnvironmentStringsW(inherited);
    for (auto const &entry : args.GetNamedObject(L"env", Json::JsonObject())) environment[std::wstring(entry.Key())] = std::wstring(entry.Value().GetString());
    std::vector<wchar_t> block; for (auto const &[key, value] : environment) { auto pair = key + L"=" + value; block.insert(block.end(), pair.begin(), pair.end()); block.push_back(0); } block.push_back(0);
    handle childIn, childOut, childErr; Pipe(childIn, input, false); Pipe(output, childOut, true); Pipe(error, childErr, true);
    STARTUPINFOEXW startup{}; startup.StartupInfo.cb = sizeof(startup); startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = childIn.get(); startup.StartupInfo.hStdOutput = childOut.get(); startup.StartupInfo.hStdError = childErr.get();
    SIZE_T size = 0; InitializeProcThreadAttributeList(nullptr, 1, 0, &size); std::vector<uint8_t> attributes(size); startup.lpAttributeList = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributes.data());
    if (!InitializeProcThreadAttributeList(startup.lpAttributeList, 1, 0, &size)) throw_last_error();
    struct Cleanup { LPPROC_THREAD_ATTRIBUTE_LIST value; ~Cleanup() { DeleteProcThreadAttributeList(value); } } cleanup{startup.lpAttributeList};
    HANDLE handles[]{childIn.get(), childOut.get(), childErr.get()};
    if (!UpdateProcThreadAttribute(startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handles, sizeof(handles), nullptr, nullptr)) throw_last_error();
    job.attach(CreateJobObjectW(nullptr, nullptr)); if (!job) throw_last_error(); JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{}; limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(job.get(), JobObjectExtendedLimitInformation, &limits, sizeof(limits))) throw_last_error();
    PROCESS_INFORMATION info{};
    if (!CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, TRUE, EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW | CREATE_SUSPENDED, block.data(), cwd.empty() ? nullptr : cwd.c_str(), &startup.StartupInfo, &info)) throw_last_error();
    process.attach(info.hProcess); handle thread{info.hThread};
    if (!AssignProcessToJobObject(job.get(), process.get())) { auto error = GetLastError(); TerminateProcess(process.get(), 1); throw hresult_error(HRESULT_FROM_WIN32(error)); }
    if (ResumeThread(thread.get()) == static_cast<DWORD>(-1)) { Stop(); throw_last_error(); }
    if (args.HasKey(L"inputBase64")) Write({initialInput, false, std::nullopt});
  }
};
REACT_MODULE(SparkProcesses, L"NativeDesktopProcesses")
struct SparkProcesses {
  struct State { React::ReactContext context; std::map<std::string, std::shared_ptr<Process>> processes; std::shared_ptr<std::atomic<bool>> active = std::make_shared<std::atomic<bool>>(true); };
  std::shared_ptr<State> state = std::make_shared<State>();
  REACT_INIT(Initialize) void Initialize(React::ReactContext const &context) noexcept { state->context = context; }
  ~SparkProcesses() { auto current = state; *current->active = false; if (current->context) current->context.UIDispatcher().Post([current]() { for (auto const &[id, process] : current->processes) process->Stop(); }); }
  REACT_METHOD(call) void call(std::string method, std::string encoded, React::ReactPromise<std::string> promise) noexcept {
    auto current = state;
    current->context.UIDispatcher().Post([current, method, encoded, promise]() {
      try {
        if (!*current->active) { promise.Reject(React::ReactError{"E_CLOSED", "Process module is closed"}); return; }
        auto args = Json::JsonObject::Parse(to_hstring(encoded));
        if (method == "resolveCommand") {
          auto path = ResolveCommand(std::wstring(args.GetNamedString(L"command")));
          promise.Resolve(to_string(path.empty() ? Json::JsonValue::CreateNullValue().Stringify() : Json::JsonValue::CreateStringValue(path).Stringify())); return;
        }
        auto id = to_string(args.GetNamedString(L"id"));
        auto found = current->processes.find(id);
        if (method == "spawn") {
          if (found != current->processes.end()) { promise.Reject(React::ReactError{"E_EXISTS", "Process id already exists"}); return; }
          auto child = std::make_shared<Process>(); child->context = current->context; child->id = id; child->Start(args);
          const auto timeout = args.HasKey(L"timeoutMs") ? static_cast<DWORD>(std::clamp(args.GetNamedNumber(L"timeoutMs"), 1.0, static_cast<double>(INFINITE - 1))) : INFINITE;
          const bool stream = args.GetNamedBoolean(L"streamOutput", false);
          std::thread([current, child, timeout, stream]() {
            std::thread input, output, error;
            try {
              input = std::thread([child]() { child->InputLoop(); });
              output = std::thread([current, child, stream]() { try { child->Read(child->output.get(), child->stdoutBytes, "stdout", stream, current->active); } catch (...) { child->truncated = true; child->Stop(); } });
              error = std::thread([current, child, stream]() { try { child->Read(child->error.get(), child->stderrBytes, "stderr", stream, current->active); } catch (...) { child->truncated = true; child->Stop(); } });
            } catch (...) { child->truncated = true; child->Stop(); }
            if (WaitForSingleObject(child->process.get(), timeout) == WAIT_TIMEOUT) { child->timedOut = true; child->Stop(); WaitForSingleObject(child->process.get(), INFINITE); }
            DWORD exit = 1; GetExitCodeProcess(child->process.get(), &exit);
            // Stop descendants that retained pipe handles when their parent exited.
            TerminateJobObject(child->job.get(), 1); child->done = true; child->condition.notify_all();
            if (input.joinable()) input.join(); if (output.joinable()) output.join(); if (error.joinable()) error.join();
            current->context.UIDispatcher().Post([current, child, exit]() {
              if (*current->active) current->context.EmitJSEvent(L"RCTDeviceEventEmitter", L"desktop", React::JSValueObject{{"type", "processExit"}, {"processId", child->id}, {"result", React::JSValueObject{
                {"exitCode", static_cast<int64_t>(exit)}, {"terminated", child->terminated.load()}, {"terminationSignal", nullptr}, {"timedOut", child->timedOut.load()}, {"outputTruncated", child->truncated.load()},
                {"stdoutBase64", Base64(child->stdoutBytes)}, {"stderrBase64", Base64(child->stderrBytes)}}});
              current->processes.erase(child->id);
            });
          }).detach();
          current->processes.emplace(id, child);
        } else if (found == current->processes.end() || found->second->done) { if (method == "terminate" || method == "closeInput") promise.Resolve("null"); else promise.Reject(React::ReactError{"E_CLOSED", "Process has exited"}); return; }
        else if (method == "terminate") found->second->StopChecked();
        else if (method == "write" || method == "closeInput") { found->second->Write({method == "write" ? DecodeBase64(to_string(args.GetNamedString(L"base64"))) : "", method == "closeInput", promise}); return; }
        else throw hresult_invalid_argument(L"Unknown process operation");
        promise.Resolve("null");
      } catch (hresult_error const &error) { const auto code = error.code();
        const char *kind = code == E_INVALIDARG ? "E_INVALID_ARGUMENT" : code == HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND) || code == HRESULT_FROM_WIN32(ERROR_PATH_NOT_FOUND) ? "E_NOT_FOUND" : code == E_ACCESSDENIED ? "E_PERMISSION_DENIED" : "E_NATIVE";
        promise.Reject(React::ReactError{kind, to_string(error.message())}); }
      catch (std::exception const &error) { promise.Reject(React::ReactError{"E_NATIVE", error.what()}); }
    });
  }
};
}
