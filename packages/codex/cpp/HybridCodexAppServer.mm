#if !defined(SPARK_CODEX_TESTING)
#include "HybridCodexAppServer.hpp"
#endif

#import <Foundation/Foundation.h>

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <cctype>
#include <condition_variable>
#include <csignal>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <fcntl.h>
#include <map>
#include <mutex>
#include <optional>
#include <poll.h>
#include <set>
#include <spawn.h>
#include <stdexcept>
#include <string>
#include <sys/types.h>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
#include <vector>

extern char** environ;

namespace margelo::nitro::legendapps::codex {

#if defined(SPARK_CODEX_TESTING)
struct CodexAvailability {
  bool available; std::string codexPath; std::string message; std::string userAgent;
  CodexAvailability(bool available, std::string codexPath, std::string message, std::string userAgent)
      : available(available), codexPath(std::move(codexPath)), message(std::move(message)), userAgent(std::move(userAgent)) {}
};
struct CodexRunResult {
  std::string model; std::string output; std::string threadId; std::string turnId; std::string userAgent;
  CodexRunResult(std::string model, std::string output, std::string threadId, std::string turnId, std::string userAgent)
      : model(std::move(model)), output(std::move(output)), threadId(std::move(threadId)), turnId(std::move(turnId)), userAgent(std::move(userAgent)) {}
};
#endif

namespace {

constexpr size_t kMaximumMessageBytes = 16 * 1024 * 1024;
constexpr size_t kMaximumStderrBytes = 16 * 1024;
constexpr double kInitializeTimeoutMs = 15'000;
constexpr double kMaximumRunTimeoutMs = 86'400'000;
constexpr size_t kMaximumPreAckBytes = kMaximumMessageBytes;

using Clock = std::chrono::steady_clock;

std::string toString(NSString* value) {
  if (value == nil) {
    return {};
  }
  const char* utf8 = value.UTF8String;
  return utf8 == nullptr ? std::string() : std::string(utf8);
}

NSString* toNSString(const std::string& value) {
  return [[NSString alloc] initWithBytes:value.data()
                                  length:value.size()
                                encoding:NSUTF8StringEncoding] ?: @"";
}

NSDictionary* parseJsonObject(const std::string& json, const std::string& context) {
  NSData* data = [NSData dataWithBytes:json.data() length:json.size()];
  NSError* error = nil;
  id value = [NSJSONSerialization JSONObjectWithData:data options:0 error:&error];
  if (![value isKindOfClass:[NSDictionary class]]) {
    std::string detail = error == nil ? "expected a JSON object" : toString(error.localizedDescription);
    throw std::runtime_error(context + ": " + detail);
  }
  return (NSDictionary*)value;
}

std::string serializeJson(NSDictionary* value) {
  NSError* error = nil;
  NSData* data = [NSJSONSerialization dataWithJSONObject:value options:0 error:&error];
  if (data == nil) {
    throw std::runtime_error("Could not encode a Codex app-server request: " + toString(error.localizedDescription));
  }
  return std::string(static_cast<const char*>(data.bytes), data.length);
}

NSDictionary* dictionaryValue(id value) {
  return [value isKindOfClass:[NSDictionary class]] ? (NSDictionary*)value : nil;
}

NSArray* arrayValue(id value) {
  return [value isKindOfClass:[NSArray class]] ? (NSArray*)value : nil;
}

NSString* stringValue(id value) {
  return [value isKindOfClass:[NSString class]] ? (NSString*)value : nil;
}

bool boolValue(id value) {
  return [value respondsToSelector:@selector(boolValue)] && [value boolValue];
}

std::string responseError(NSDictionary* response) {
  NSDictionary* error = dictionaryValue(response[@"error"]);
  if (error == nil) {
    return {};
  }
  NSString* message = stringValue(error[@"message"]);
  if (message != nil) {
    return toString(message);
  }
  return toString([error description]);
}

bool containsInsensitive(const std::string& value, const std::string& needle) {
  std::string lowerValue(value);
  std::string lowerNeedle(needle);
  std::transform(lowerValue.begin(), lowerValue.end(), lowerValue.begin(), ::tolower);
  std::transform(lowerNeedle.begin(), lowerNeedle.end(), lowerNeedle.begin(), ::tolower);
  return lowerValue.find(lowerNeedle) != std::string::npos;
}

std::string actionableError(const std::string& message) {
  if (message.empty()) {
    return "Codex failed without an error message. Run `codex login` in Terminal, then try again.";
  }
  if (containsInsensitive(message, "auth") || containsInsensitive(message, "login") ||
      containsInsensitive(message, "unauthorized") || containsInsensitive(message, "401")) {
    if (containsInsensitive(message, "codex login")) {
      return message;
    }
    return message + " Run `codex login` in Terminal, then try again.";
  }
  if (containsInsensitive(message, "rate limit") || containsInsensitive(message, "usage limit") ||
      containsInsensitive(message, "quota")) {
    return message + " Wait for your Codex usage limit to reset, or select another model in Codex.";
  }
  if (containsInsensitive(message, "method not found") || containsInsensitive(message, "invalid params") ||
      containsInsensitive(message, "protocol")) {
    return message + " Update Codex to a version that supports app-server, then reopen the app.";
  }
  return message;
}

std::string resolveCodexPath() {
  @autoreleasepool {
    NSFileManager* fileManager = [NSFileManager defaultManager];
    NSMutableArray<NSString*>* candidates = [NSMutableArray array];
    NSString* explicitPath = NSProcessInfo.processInfo.environment[@"CODEX_PATH"];
    if (explicitPath.length > 0) {
      [candidates addObject:[explicitPath stringByExpandingTildeInPath]];
    }

    NSString* path = NSProcessInfo.processInfo.environment[@"PATH"];
    for (NSString* directory in [path componentsSeparatedByString:@":"]) {
      if (directory.length > 0) {
        [candidates addObject:[directory stringByAppendingPathComponent:@"codex"]];
      }
    }

    NSString* home = NSHomeDirectory();
    [candidates addObjectsFromArray:@[
      [home stringByAppendingPathComponent:@".local/bin/codex"],
      [home stringByAppendingPathComponent:@".bun/bin/codex"],
      [home stringByAppendingPathComponent:@"bin/codex"],
      @"/opt/homebrew/bin/codex",
      @"/usr/local/bin/codex",
      @"/usr/bin/codex",
    ]];

    NSMutableSet<NSString*>* visited = [NSMutableSet set];
    for (NSString* candidate in candidates) {
      NSString* standardized = candidate.stringByStandardizingPath;
      if ([visited containsObject:standardized]) {
        continue;
      }
      [visited addObject:standardized];
      BOOL isDirectory = NO;
      if ([fileManager fileExistsAtPath:standardized isDirectory:&isDirectory] && !isDirectory &&
          [fileManager isExecutableFileAtPath:standardized]) {
        return toString(standardized);
      }
    }
    return {};
  }
}

NSString* defaultWorkingDirectory();

NSString* isolatedCodexHome() {
  NSString* bundleIdentifier = NSBundle.mainBundle.bundleIdentifier ?: @"legend-apps";
  NSString* path = [defaultWorkingDirectory()
      stringByAppendingPathComponent:[@"codex-home-" stringByAppendingString:bundleIdentifier]];
  NSFileManager* fileManager = NSFileManager.defaultManager;
  [fileManager createDirectoryAtPath:path
         withIntermediateDirectories:YES
                          attributes:nil
                               error:nil];
  [fileManager setAttributes:@{NSFilePosixPermissions: @(0700)} ofItemAtPath:path error:nil];

  NSString* sourceCodexHome = NSProcessInfo.processInfo.environment[@"CODEX_HOME"];
  if (sourceCodexHome.length == 0) {
    sourceCodexHome = [NSHomeDirectory() stringByAppendingPathComponent:@".codex"];
  }
  NSString* sourceAuthPath = [sourceCodexHome stringByAppendingPathComponent:@"auth.json"];
  NSString* targetAuthPath = [path stringByAppendingPathComponent:@"auth.json"];
  if ([fileManager fileExistsAtPath:sourceAuthPath] && ![fileManager fileExistsAtPath:targetAuthPath]) {
    [fileManager createSymbolicLinkAtPath:targetAuthPath withDestinationPath:sourceAuthPath error:nil];
  }
  return path;
}

std::vector<std::string> sanitizedEnvironmentStorage() {
  static const std::set<std::string> excluded = {
    "CODEX_CI",
    "CODEX_CLI_AUTH_CREDENTIALS_STORE",
    "CODEX_HOME",
    "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
    "CODEX_SESSION_ID",
    "CODEX_SHELL",
    "CODEX_THREAD_ID",
  };
  std::vector<std::string> values;
  for (char** entry = environ; entry != nullptr && *entry != nullptr; ++entry) {
    std::string value(*entry);
    const size_t separator = value.find('=');
    const std::string key = value.substr(0, separator);
    if (!excluded.contains(key)) {
      values.push_back(std::move(value));
    }
  }
  values.push_back("CODEX_CLI_AUTH_CREDENTIALS_STORE=file");
  values.push_back("CODEX_HOME=" + toString(isolatedCodexHome()));
  return values;
}

NSMutableDictionary<NSString*, NSString*>* sanitizedEnvironmentDictionary() {
  NSMutableDictionary<NSString*, NSString*>* environment =
      [NSProcessInfo.processInfo.environment mutableCopy];
  for (NSString* key in @[
         @"CODEX_CI",
         @"CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
         @"CODEX_SESSION_ID",
         @"CODEX_SHELL",
         @"CODEX_THREAD_ID",
       ]) {
    [environment removeObjectForKey:key];
  }
  environment[@"CODEX_CLI_AUTH_CREDENTIALS_STORE"] = @"file";
  environment[@"CODEX_HOME"] = isolatedCodexHome();
  return environment;
}

NSString* defaultWorkingDirectory() {
  NSString* path = [NSTemporaryDirectory() stringByAppendingPathComponent:@"legend-codex-workspace"];
  NSError* error = nil;
  if ([[NSFileManager defaultManager] createDirectoryAtPath:path
                                withIntermediateDirectories:YES
                                                 attributes:nil
                                                      error:&error]) {
    return path;
  }
  return NSTemporaryDirectory();
}

std::vector<char*> pointerArray(std::vector<std::string>& values) {
  std::vector<char*> pointers;
  pointers.reserve(values.size() + 1);
  for (std::string& value : values) {
    pointers.push_back(value.data());
  }
  pointers.push_back(nullptr);
  return pointers;
}

struct TurnState {
  std::string error;
  std::string output;
  std::string threadId;
  bool done = false;
  bool acknowledged = false;
  uint64_t sequence = 0;
  size_t preAckBytes = 0;
  bool preAckLimitExceeded = false;
};

class CodexProcessSupervisor {
public:
  static CodexProcessSupervisor& shared() {
    static CodexProcessSupervisor* supervisor = new CodexProcessSupervisor();
    return *supervisor;
  }

  CodexAvailability getAvailability() {
    @autoreleasepool {
      const std::string path = resolveCodexPath();
      if (path.empty()) {
        return CodexAvailability(
            false,
            "",
            "Codex CLI was not found. Install Codex, or set CODEX_PATH to the Codex executable, then reopen the app.",
            "");
      }
      {
        std::lock_guard lock(mutex_);
        if (useExecFallback_) {
          return CodexAvailability(
              true,
              path,
              "Codex is ready in compatibility mode.",
              userAgent_);
        }
      }
      try {
        ensureInitialized();
        std::lock_guard lock(mutex_);
        return CodexAvailability(true, codexPath_, "Codex is ready.", userAgent_);
      } catch (const std::exception& error) {
        return CodexAvailability(false, path, actionableError(error.what()), "");
      }
    }
  }

  CodexRunResult runPrompt(
      const std::string& prompt,
      const std::string& cwd,
      const std::string& reasoningEffort,
      double timeoutMs,
      const std::string& outputSchemaJson,
      const std::string& developerInstructions) {
    @autoreleasepool {
      if (prompt.empty()) {
        throw std::runtime_error("Enter a prompt before running Codex.");
      }
      if (!std::isfinite(timeoutMs) || std::floor(timeoutMs) != timeoutMs || timeoutMs < 1'000 || timeoutMs > kMaximumRunTimeoutMs) {
        throw std::runtime_error("Codex timeout must be a whole number from 1000 to 86400000 milliseconds.");
      }

      uint64_t acceptedCancellationGeneration = 0;
      {
        std::lock_guard lock(mutex_);
        acceptedCancellationGeneration = cancelGeneration_;
        ++activeRuns_;
      }
      struct RunGuard {
        CodexProcessSupervisor* owner;
        ~RunGuard() { std::lock_guard lock(owner->mutex_); --owner->activeRuns_; owner->condition_.notify_all(); }
      } runGuard{this};
      auto throwIfCancelled = [&]() {
        std::lock_guard lock(mutex_);
        if (cancelGeneration_ != acceptedCancellationGeneration) throw std::runtime_error("Codex request was cancelled.");
      };

      const auto deadline = Clock::now() + std::chrono::milliseconds(static_cast<int64_t>(timeoutMs));
      NSString* requestedCwd = cwd.empty() ? defaultWorkingDirectory() : toNSString(cwd);
      BOOL isDirectory = NO;
      if (![[NSFileManager defaultManager] fileExistsAtPath:requestedCwd isDirectory:&isDirectory] || !isDirectory) {
        throw std::runtime_error("Codex working directory does not exist: " + toString(requestedCwd));
      }

      bool useExecFallback = false;
      {
        std::lock_guard lock(mutex_);
        useExecFallback = useExecFallback_;
      }
      if (useExecFallback) {
        throwIfCancelled();
        return runExecFallback(
            prompt,
            requestedCwd,
            reasoningEffort,
            outputSchemaJson,
            developerInstructions,
            acceptedCancellationGeneration,
            std::min(deadline, Clock::now() + std::chrono::seconds(20)));
      }

      try { ensureInitialized(acceptedCancellationGeneration, deadline); } catch (...) { throwIfCancelled(); throw; }
      throwIfCancelled();
      uint64_t runProcessGeneration = 0;
      { std::lock_guard lock(mutex_); runProcessGeneration = processGeneration_; }
      if (runProcessGeneration == 0) throw std::runtime_error("Codex app-server is not running.");

      NSMutableDictionary* threadParams = [@{
        @"approvalPolicy": @"never",
        @"config": @{
          @"cli_auth_credentials_store": @"file",
          @"features": @{
            @"apps": @NO,
            @"plugins": @NO,
            @"remote_plugin": @NO,
            @"shell_snapshot": @NO,
            @"shell_tool": @NO,
          },
          @"mcp_servers": @{},
          @"orchestrator": @{
            @"mcp": @{
              @"enabled": @NO,
            },
          },
        },
        @"cwd": requestedCwd,
        @"ephemeral": @YES,
        @"sandbox": @"read-only",
      } mutableCopy];
      if (!developerInstructions.empty()) {
        threadParams[@"developerInstructions"] = toNSString(developerInstructions);
      }

      NSDictionary* threadResponse = nil;
      try {
        const auto threadDeadline = std::min(deadline, Clock::now() + std::chrono::seconds(5));
        threadResponse = request(@"thread/start", threadParams, threadDeadline, acceptedCancellationGeneration, runProcessGeneration);
      } catch (const std::exception& error) {
        throwIfCancelled();
        if (!containsInsensitive(error.what(), "did not respond in time")) {
          throw;
        }
        {
          std::lock_guard lock(mutex_);
          if (processGeneration_ != runProcessGeneration) throw std::runtime_error("Codex app-server restarted during thread startup.");
          useExecFallback_ = true;
        }
        terminateProcessGeneration(runProcessGeneration, "Codex app-server did not respond during thread startup.");
        return runExecFallback(
            prompt,
            requestedCwd,
            reasoningEffort,
            outputSchemaJson,
            developerInstructions,
            acceptedCancellationGeneration,
            std::min(deadline, Clock::now() + std::chrono::seconds(20)));
      }
      throwIfCancelled();
      throwForResponseError(threadResponse, "Codex could not start a thread");
      NSDictionary* threadResult = dictionaryValue(threadResponse[@"result"]);
      NSDictionary* thread = dictionaryValue(threadResult[@"thread"]);
      std::string threadId = toString(stringValue(thread[@"id"]));
      std::string model = toString(stringValue(threadResult[@"model"]));
      if (threadId.empty()) {
        throw std::runtime_error(
            "Codex app-server returned an invalid thread response. Update Codex, then reopen the app.");
      }

      NSMutableDictionary* turnParams = [@{
        @"effort": toNSString(reasoningEffort),
        @"input": @[@{
          @"text": toNSString(prompt),
          @"text_elements": @[],
          @"type": @"text",
        }],
        @"threadId": toNSString(threadId),
      } mutableCopy];
      if (!outputSchemaJson.empty()) {
        NSDictionary* schema = parseJsonObject(outputSchemaJson, "Invalid Codex output schema");
        turnParams[@"outputSchema"] = schema;
      }

      {
        std::lock_guard lock(mutex_);
        if (processGeneration_ != runProcessGeneration) throw std::runtime_error("Codex app-server restarted before turn startup.");
        ++pendingTurnStarts_;
      }
      bool pendingTurnStart = true;
      auto finishPendingTurnStart = [&]() {
        if (!pendingTurnStart) return;
        std::lock_guard lock(mutex_);
        if (processGeneration_ == runProcessGeneration && pendingTurnStarts_ > 0) --pendingTurnStarts_;
        pendingTurnStart = false;
      };
      std::string turnId;
      uint64_t cancelGeneration = acceptedCancellationGeneration;
      try {
        NSDictionary* turnResponse = request(@"turn/start", turnParams, deadline, acceptedCancellationGeneration, runProcessGeneration);
#if defined(SPARK_CODEX_TESTING)
        if (const char* delay = std::getenv("CODEX_TEST_DELAY_AFTER_TURN_RESPONSE_MS")) {
          const int milliseconds = std::max(0, std::min(1000, std::atoi(delay)));
          std::this_thread::sleep_for(std::chrono::milliseconds(milliseconds));
        }
#endif
        throwIfCancelled();
        throwForResponseError(turnResponse, "Codex could not start a turn");
        NSDictionary* turnResult = dictionaryValue(turnResponse[@"result"]);
        NSDictionary* turn = dictionaryValue(turnResult[@"turn"]);
        turnId = toString(stringValue(turn[@"id"]));
        if (turnId.empty()) {
          throw std::runtime_error(
              "Codex app-server returned an invalid turn response. Update Codex, then reopen the app.");
        }
        std::lock_guard lock(mutex_);
        if (processGeneration_ != runProcessGeneration) throw std::runtime_error("Codex app-server restarted before the turn was accepted.");
        TurnState& state = turns_[turnId];
        state.threadId = threadId;
        preAckBytes_ -= state.preAckBytes;
        state.preAckBytes = 0;
        state.acknowledged = true;
        --pendingTurnStarts_;
        pendingTurnStart = false;
      } catch (...) {
        finishPendingTurnStart();
        throwIfCancelled();
        throw;
      }

      TurnState completed;
      {
        std::unique_lock lock(mutex_);
        const bool finished = condition_.wait_until(lock, deadline, [&]() {
          const auto state = turns_.find(turnId);
          return processGeneration_ != runProcessGeneration || cancelGeneration_ != cancelGeneration ||
              (state != turns_.end() && state->second.done);
        });
        auto state = turns_.find(turnId);
        if (cancelGeneration_ != cancelGeneration) {
          throw std::runtime_error("Codex request was cancelled.");
        } else if (processGeneration_ != runProcessGeneration) {
          const std::string detail = processError_.empty() ? "Codex app-server restarted while the request was running." : processError_;
          throw std::runtime_error(actionableError(detail));
        } else if (finished && state != turns_.end() && state->second.done) {
          completed = state->second;
          turns_.erase(state);
          retireTurnLocked(turnId);
        } else {
          turns_.erase(turnId);
          retireTurnLocked(turnId);
          lock.unlock();
          interruptTurn(threadId, turnId, runProcessGeneration);
          const int seconds = static_cast<int>(timeoutMs / 1000.0);
          throw std::runtime_error(
              "Codex did not finish within " + std::to_string(seconds) +
              " seconds. Try a shorter prompt; if Codex is also stuck in Terminal, run `codex login`.");
        }
      }

      if (!completed.error.empty()) {
        throw std::runtime_error(actionableError(completed.error));
      }
      if (completed.preAckLimitExceeded) {
        throw std::runtime_error("Codex app-server response exceeded the 16 MiB pre-ack notification limit.");
      }
      if (completed.output.empty()) {
        throw std::runtime_error(
            "Codex completed without a response. Try again; if it keeps happening, update Codex and reopen the app.");
      }

      std::lock_guard lock(mutex_);
      return CodexRunResult(model, completed.output, threadId, turnId, userAgent_);
    }
  }

  double cancelActiveRuns() {
    pid_t serverPid = -1;
    uint64_t serverGeneration = 0;
    size_t acceptedRuns = 0;
    std::vector<pid_t> fallbackPids;
    {
      std::lock_guard lock(mutex_);
      ++cancelGeneration_;
      acceptedRuns = activeRuns_;
      serverPid = activeRuns_ > 0 ? pid_ : -1;
      serverGeneration = activeRuns_ > 0 ? processGeneration_ : 0;
      fallbackPids.assign(fallbackPids_.begin(), fallbackPids_.end());
      condition_.notify_all();
    }
    if (serverGeneration > 0) terminateProcessGeneration(serverGeneration, "Codex request was cancelled.");
    else if (serverPid > 0) kill(-serverPid, SIGTERM);
    for (pid_t pid : fallbackPids) {
      kill(pid, SIGTERM);
    }
    return static_cast<double>(acceptedRuns);
  }

  double shutdown() {
    std::lock_guard lifecycleLock(lifecycleMutex_);
    pid_t pid = -1;
    int stdinFd = -1;
    std::vector<pid_t> fallbackPids;
    {
      std::lock_guard lock(mutex_);
      ++cancelGeneration_;
      pid = pid_;
      stdinFd = stdinFd_;
      pid_ = -1;
      stdinFd_ = -1;
      initialized_ = false;
      processGeneration_ = 0;
      processError_ = "Codex app-server was stopped.";
      responses_.clear();
      ignoredResponseIds_.clear();
      fallbackPids.assign(fallbackPids_.begin(), fallbackPids_.end());
      fallbackPids_.clear();
      useExecFallback_ = false;
      for (auto& [turnId, state] : turns_) {
        state.error = processError_;
        state.done = true;
      }
      condition_.notify_all();
    }
    if (stdinFd >= 0) {
      close(stdinFd);
    }
    if (pid > 0) {
      kill(-pid, SIGTERM);
    }
    for (pid_t fallbackPid : fallbackPids) {
      kill(fallbackPid, SIGTERM);
    }
    return static_cast<double>((pid > 0 ? 1 : 0) + fallbackPids.size());
  }

#if defined(SPARK_CODEX_TESTING)
  size_t retainedTurnCountForTesting() {
    std::lock_guard lock(mutex_);
    return turns_.size();
  }
  size_t blockedWriteCountForTesting() {
    std::lock_guard lock(mutex_);
    return blockedWriteCount_;
  }
#endif

private:
  void retireTurnLocked(const std::string& turnId) {
    if (turnId.empty() || !retiredTurnIds_.insert(turnId).second) return;
    retiredTurnOrder_.push_back(turnId);
    while (retiredTurnOrder_.size() > 512) {
      retiredTurnIds_.erase(retiredTurnOrder_.front());
      retiredTurnOrder_.pop_front();
    }
  }

  TurnState* pendingOrActiveTurnLocked(const std::string& turnId) {
    if (turnId.empty() || retiredTurnIds_.contains(turnId)) return nullptr;
    auto found = turns_.find(turnId);
    if (found != turns_.end()) return &found->second;
    if (pendingTurnStarts_ == 0) return nullptr;
    while (turns_.size() >= 128) {
      auto oldest = turns_.end();
      for (auto it = turns_.begin(); it != turns_.end(); ++it) {
        if (!it->second.acknowledged && (oldest == turns_.end() || it->second.sequence < oldest->second.sequence)) oldest = it;
      }
      if (oldest == turns_.end()) return nullptr;
      preAckBytes_ -= oldest->second.preAckBytes;
      turns_.erase(oldest);
    }
    TurnState state;
    state.sequence = ++nextTurnSequence_;
    return &turns_.emplace(turnId, std::move(state)).first->second;
  }

  void setPreAckTextLocked(TurnState& state, std::string TurnState::*field, const std::string& value) {
    std::string& current = state.*field;
    if (state.acknowledged) { current = value; return; }
    if (state.preAckLimitExceeded) return;
    const size_t nextTotal = preAckBytes_ - current.size() + value.size();
    if (nextTotal > kMaximumPreAckBytes) {
      preAckBytes_ -= state.preAckBytes;
      state.preAckBytes = 0;
      state.output.clear();
      state.error.clear();
      state.preAckLimitExceeded = true;
      return;
    }
    preAckBytes_ = nextTotal;
    state.preAckBytes = state.preAckBytes - current.size() + value.size();
    current = value;
  }

  CodexRunResult runExecFallback(
      const std::string& prompt,
      NSString* requestedCwd,
      const std::string& reasoningEffort,
      const std::string& outputSchemaJson,
      const std::string& developerInstructions,
      uint64_t acceptedCancellationGeneration,
      Clock::time_point deadline) {
    { std::lock_guard lock(mutex_); if (cancelGeneration_ != acceptedCancellationGeneration) throw std::runtime_error("Codex request was cancelled."); }
    const std::string codexPath = resolveCodexPath();
    if (codexPath.empty()) {
      throw std::runtime_error(
          "Codex CLI was not found. Install Codex, or set CODEX_PATH to the Codex executable, then reopen the app.");
    }

    NSFileManager* fileManager = [NSFileManager defaultManager];
    NSString* temporaryDirectory = NSTemporaryDirectory();
    NSString* identifier = NSUUID.UUID.UUIDString;
    NSString* promptPath = [temporaryDirectory
        stringByAppendingPathComponent:[NSString stringWithFormat:@"legend-codex-%@-prompt.txt", identifier]];
    NSString* outputPath = [temporaryDirectory
        stringByAppendingPathComponent:[NSString stringWithFormat:@"legend-codex-%@-output.txt", identifier]];
    NSString* errorPath = [temporaryDirectory
        stringByAppendingPathComponent:[NSString stringWithFormat:@"legend-codex-%@-error.txt", identifier]];
    NSString* schemaPath = outputSchemaJson.empty()
        ? nil
        : [temporaryDirectory
              stringByAppendingPathComponent:[NSString stringWithFormat:@"legend-codex-%@-schema.json", identifier]];
    NSArray<NSString*>* temporaryPaths = schemaPath == nil
        ? @[promptPath, outputPath, errorPath]
        : @[promptPath, outputPath, errorPath, schemaPath];
    auto cleanup = [&]() {
      for (NSString* path in temporaryPaths) {
        [fileManager removeItemAtPath:path error:nil];
      }
    };

    std::string combinedPrompt = prompt;
    if (!developerInstructions.empty()) {
      combinedPrompt = developerInstructions + "\n\nUser request:\n" + prompt;
    }
    NSError* fileError = nil;
    if (![toNSString(combinedPrompt) writeToFile:promptPath
                                      atomically:YES
                                        encoding:NSUTF8StringEncoding
                                           error:&fileError]) {
      cleanup();
      throw std::runtime_error(
          "Could not prepare the Codex request: " + toString(fileError.localizedDescription));
    }
    [fileManager createFileAtPath:outputPath contents:nil attributes:nil];
    [fileManager createFileAtPath:errorPath contents:nil attributes:nil];

    if (schemaPath != nil) {
      parseJsonObject(outputSchemaJson, "Invalid Codex output schema");
      if (![toNSString(outputSchemaJson) writeToFile:schemaPath
                                           atomically:YES
                                             encoding:NSUTF8StringEncoding
                                                error:&fileError]) {
        cleanup();
        throw std::runtime_error(
            "Could not prepare the Codex output schema: " + toString(fileError.localizedDescription));
      }
    }

    NSMutableArray<NSString*>* arguments = [NSMutableArray arrayWithArray:@[
      @"--ask-for-approval",
      @"never",
      @"exec",
      @"--ephemeral",
      @"--ignore-user-config",
      @"--ignore-rules",
      @"--disable",
      @"apps",
      @"--disable",
      @"plugins",
      @"--disable",
      @"remote_plugin",
      @"--disable",
      @"shell_snapshot",
      @"--disable",
      @"shell_tool",
      @"--skip-git-repo-check",
      @"--color",
      @"never",
      @"--sandbox",
      @"read-only",
      @"--config",
      [NSString stringWithFormat:@"model_reasoning_effort=\"%@\"", toNSString(reasoningEffort)],
      @"--config",
      @"mcp_servers={}",
      @"--config",
      @"orchestrator.mcp.enabled=false",
      @"--config",
      @"cli_auth_credentials_store=\"file\"",
      @"--output-last-message",
      outputPath,
    ]];
    if (schemaPath != nil) {
      [arguments addObjectsFromArray:@[@"--output-schema", schemaPath]];
    }
    [arguments addObject:@"-"];

    NSFileHandle* promptHandle = [NSFileHandle fileHandleForReadingAtPath:promptPath];
    NSFileHandle* errorHandle = [NSFileHandle fileHandleForWritingAtPath:errorPath];
    if (promptHandle == nil || errorHandle == nil) {
      cleanup();
      throw std::runtime_error("Could not open temporary files for the Codex request.");
    }

    NSTask* task = [NSTask new];
    task.executableURL = [NSURL fileURLWithPath:toNSString(codexPath)];
    task.arguments = arguments;
    task.currentDirectoryURL = [NSURL fileURLWithPath:requestedCwd isDirectory:YES];
    task.environment = sanitizedEnvironmentDictionary();
    task.standardInput = promptHandle;
    task.standardOutput = NSFileHandle.fileHandleWithNullDevice;
    task.standardError = errorHandle;

    NSError* launchError = nil;
    if (![task launchAndReturnError:&launchError]) {
      [promptHandle closeFile];
      [errorHandle closeFile];
      cleanup();
      throw std::runtime_error(
          actionableError("Could not start Codex: " + toString(launchError.localizedDescription)));
    }

    const pid_t pid = task.processIdentifier;
    {
      std::lock_guard lock(mutex_);
      fallbackPids_.insert(pid);
      if (cancelGeneration_ != acceptedCancellationGeneration) kill(pid, SIGTERM);
    }
    while (task.isRunning && Clock::now() < deadline) {
      { std::lock_guard lock(mutex_); if (cancelGeneration_ != acceptedCancellationGeneration) break; }
      usleep(10'000);
    }
    if (task.isRunning) {
      [task terminate];
      const auto terminationDeadline = Clock::now() + std::chrono::seconds(1);
      while (task.isRunning && Clock::now() < terminationDeadline) {
        usleep(10'000);
      }
      if (task.isRunning) {
        kill(pid, SIGKILL);
      }
    }
    [task waitUntilExit];
    [promptHandle closeFile];
    [errorHandle closeFile];
    {
      std::lock_guard lock(mutex_);
      fallbackPids_.erase(pid);
    }

    NSString* output = [NSString stringWithContentsOfFile:outputPath
                                                  encoding:NSUTF8StringEncoding
                                                     error:nil] ?: @"";
    NSString* errorOutput = [NSString stringWithContentsOfFile:errorPath
                                                       encoding:NSUTF8StringEncoding
                                                          error:nil] ?: @"";
    cleanup();

    {
      std::lock_guard lock(mutex_);
      if (cancelGeneration_ != acceptedCancellationGeneration) {
        throw std::runtime_error("Codex request was cancelled.");
      }
    }
    if (Clock::now() >= deadline) {
      throw std::runtime_error(
          "Codex could not start from this app. In Terminal, run `codex login status`, then "
          "`codex exec \"Reply with ok\"`. If both work, update Codex and reopen this app; "
          "your Codex version has a background-process startup issue.");
    }
    if (task.terminationStatus != 0) {
      std::string detail = toString([errorOutput stringByTrimmingCharactersInSet:
          NSCharacterSet.whitespaceAndNewlineCharacterSet]);
      if (detail.empty()) {
        detail = "Codex exited with status " + std::to_string(task.terminationStatus) + ".";
      }
      throw std::runtime_error(actionableError("Codex could not generate suggestions: " + detail));
    }
    std::string result = toString([output stringByTrimmingCharactersInSet:
        NSCharacterSet.whitespaceAndNewlineCharacterSet]);
    if (result.empty()) {
      throw std::runtime_error(
          "Codex completed without a response. Try again; if it keeps happening, update Codex and reopen the app.");
    }
    std::lock_guard lock(mutex_);
    return CodexRunResult("", result, "", "", userAgent_);
  }

  void ensureInitialized(uint64_t cancellationGeneration = UINT64_MAX, Clock::time_point runDeadline = Clock::time_point::max()) {
    const auto initializeDeadline = std::min(runDeadline, Clock::now() + std::chrono::milliseconds(static_cast<int64_t>(kInitializeTimeoutMs)));
    std::unique_lock lifecycleLock(lifecycleMutex_, std::defer_lock);
    while (!lifecycleLock.try_lock_for(std::chrono::milliseconds(10))) {
      std::lock_guard lock(mutex_);
      if (cancellationGeneration != UINT64_MAX && cancelGeneration_ != cancellationGeneration) throw std::runtime_error("Codex request was cancelled.");
      if (Clock::now() >= initializeDeadline) throw std::runtime_error("Codex app-server did not respond in time.");
    }
    {
      std::lock_guard lock(mutex_);
      if (initialized_ && pid_ > 0) {
        return;
      }
    }
    startProcess();
    try {
      const auto deadline = initializeDeadline;
      NSDictionary* response = request(@"initialize", @{
        @"capabilities": @{
          @"experimentalApi": @NO,
          @"optOutNotificationMethods": @[
            @"account/rateLimits/updated",
            @"item/agentMessage/delta",
            @"item/started",
            @"mcpServer/startupStatus/updated",
            @"thread/started",
            @"thread/status/changed",
            @"thread/tokenUsage/updated",
            @"turn/started",
          ],
          @"requestAttestation": @NO,
        },
        @"clientInfo": @{
          @"name": @"legend-apps",
          @"title": @"Legend Apps",
          @"version": @"0.0.1",
        },
      }, deadline, cancellationGeneration);
      throwForResponseError(response, "Codex app-server could not initialize");
      NSDictionary* result = dictionaryValue(response[@"result"]);
      std::string userAgent = toString(stringValue(result[@"userAgent"]));
      if (userAgent.empty()) {
        throw std::runtime_error(
            "Codex app-server returned an invalid initialize response. Update Codex, then reopen the app.");
      }
      sendNotification(@"initialized", cancellationGeneration, deadline);
      {
        std::lock_guard lock(mutex_);
        userAgent_ = userAgent;
        initialized_ = true;
      }
    } catch (...) {
      terminateCurrentProcess();
      throw;
    }
  }

  void startProcess() {
    terminateCurrentProcess();
    const std::string codexPath = resolveCodexPath();
    if (codexPath.empty()) {
      throw std::runtime_error(
          "Codex CLI was not found. Install Codex, or set CODEX_PATH to the Codex executable, then reopen the app.");
    }

    int inputPipe[2] = {-1, -1};
    int outputPipe[2] = {-1, -1};
    int errorPipe[2] = {-1, -1};
    if (pipe(inputPipe) != 0 || pipe(outputPipe) != 0 || pipe(errorPipe) != 0) {
      closePipe(inputPipe);
      closePipe(outputPipe);
      closePipe(errorPipe);
      throw std::runtime_error("Could not create pipes for Codex app-server: " + std::string(strerror(errno)));
    }

    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, inputPipe[0], STDIN_FILENO);
    posix_spawn_file_actions_adddup2(&actions, outputPipe[1], STDOUT_FILENO);
    posix_spawn_file_actions_adddup2(&actions, errorPipe[1], STDERR_FILENO);
    posix_spawn_file_actions_addclose(&actions, inputPipe[0]);
    posix_spawn_file_actions_addclose(&actions, inputPipe[1]);
    posix_spawn_file_actions_addclose(&actions, outputPipe[0]);
    posix_spawn_file_actions_addclose(&actions, outputPipe[1]);
    posix_spawn_file_actions_addclose(&actions, errorPipe[0]);
    posix_spawn_file_actions_addclose(&actions, errorPipe[1]);
#if defined(__APPLE__)
    posix_spawn_file_actions_addchdir_np(&actions, defaultWorkingDirectory().fileSystemRepresentation);
#endif

    posix_spawnattr_t attributes;
    posix_spawnattr_init(&attributes);
    short spawnFlags = 0;
#if defined(__APPLE__) && defined(POSIX_SPAWN_CLOEXEC_DEFAULT)
    spawnFlags |= POSIX_SPAWN_CLOEXEC_DEFAULT;
#endif
    sigset_t emptySignalMask;
    sigemptyset(&emptySignalMask);
    posix_spawnattr_setsigmask(&attributes, &emptySignalMask);
    spawnFlags |= POSIX_SPAWN_SETSIGMASK;

    sigset_t defaultSignals;
    sigfillset(&defaultSignals);
    sigdelset(&defaultSignals, SIGKILL);
    sigdelset(&defaultSignals, SIGSTOP);
    posix_spawnattr_setsigdefault(&attributes, &defaultSignals);
    spawnFlags |= POSIX_SPAWN_SETSIGDEF;
    posix_spawnattr_setpgroup(&attributes, 0);
    spawnFlags |= POSIX_SPAWN_SETPGROUP;
    posix_spawnattr_setflags(&attributes, spawnFlags);

    std::vector<std::string> arguments = {codexPath, "app-server", "--stdio"};
    std::vector<char*> argumentPointers = pointerArray(arguments);
    std::vector<std::string> environment = sanitizedEnvironmentStorage();
    std::vector<char*> environmentPointers = pointerArray(environment);
    pid_t pid = -1;
    const int spawnError = posix_spawn(
        &pid,
        codexPath.c_str(),
        &actions,
        &attributes,
        argumentPointers.data(),
        environmentPointers.data());
    posix_spawnattr_destroy(&attributes);
    posix_spawn_file_actions_destroy(&actions);
    close(inputPipe[0]);
    close(outputPipe[1]);
    close(errorPipe[1]);
    if (spawnError != 0) {
      close(inputPipe[1]);
      close(outputPipe[0]);
      close(errorPipe[0]);
      throw std::runtime_error("Could not start Codex app-server: " + std::string(strerror(spawnError)));
    }

#if defined(F_SETNOSIGPIPE)
    fcntl(inputPipe[1], F_SETNOSIGPIPE, 1);
#endif
    const int inputFlags = fcntl(inputPipe[1], F_GETFL, 0);
    if (inputFlags >= 0) fcntl(inputPipe[1], F_SETFL, inputFlags | O_NONBLOCK);
    uint64_t generation = 0;
    {
      std::lock_guard lock(mutex_);
      generation = ++nextProcessGeneration_;
      processGeneration_ = generation;
      pid_ = pid;
      stdinFd_ = inputPipe[1];
      initialized_ = false;
      codexPath_ = codexPath;
      userAgent_.clear();
      processError_.clear();
      stderrTail_.clear();
      responses_.clear();
      ignoredResponseIds_.clear();
      turns_.clear();
      preAckBytes_ = 0;
      pendingTurnStarts_ = 0;
      retiredTurnIds_.clear();
      retiredTurnOrder_.clear();
    }

    std::thread([this, fd = outputPipe[0], generation]() { readStdout(fd, generation); }).detach();
    std::thread([this, fd = errorPipe[0], generation]() { readStderr(fd, generation); }).detach();
    std::thread([this, pid, generation]() {
      int status = 0;
      while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {
      }
      processExited(pid, generation, status);
    }).detach();
  }

  static void closePipe(int pipeFds[2]) {
    if (pipeFds[0] >= 0) {
      close(pipeFds[0]);
    }
    if (pipeFds[1] >= 0) {
      close(pipeFds[1]);
    }
  }

  void terminateCurrentProcess() {
    pid_t pid = -1;
    int stdinFd = -1;
    {
      std::lock_guard lock(mutex_);
      pid = pid_;
      stdinFd = stdinFd_;
      pid_ = -1;
      stdinFd_ = -1;
      initialized_ = false;
      processGeneration_ = 0;
      responses_.clear();
      ignoredResponseIds_.clear();
      turns_.clear();
      preAckBytes_ = 0;
      pendingTurnStarts_ = 0;
      condition_.notify_all();
    }
    if (stdinFd >= 0) {
      close(stdinFd);
    }
    if (pid > 0) {
      kill(-pid, SIGTERM);
    }
  }

  void terminateProcessGeneration(uint64_t generation, const std::string& reason) {
    pid_t pid = -1;
    int stdinFd = -1;
    {
      std::lock_guard lock(mutex_);
      if (processGeneration_ != generation) return;
      pid = pid_;
      stdinFd = stdinFd_;
      pid_ = -1;
      stdinFd_ = -1;
      initialized_ = false;
      processGeneration_ = 0;
      processError_ = reason;
      turns_.clear();
      preAckBytes_ = 0;
      pendingTurnStarts_ = 0;
      condition_.notify_all();
    }
    if (stdinFd >= 0) close(stdinFd);
    if (pid > 0) kill(-pid, SIGTERM);
  }

  NSDictionary* request(NSString* method, NSDictionary* params, Clock::time_point deadline, uint64_t cancellationGeneration = UINT64_MAX, uint64_t expectedGeneration = 0) {
    int64_t requestId = 0;
    uint64_t generation = 0;
    {
      std::lock_guard lock(mutex_);
      requestId = nextRequestId_++;
      generation = processGeneration_;
      if (expectedGeneration != 0 && generation != expectedGeneration) throw std::runtime_error("Codex app-server restarted during the request.");
      if (generation == 0 || stdinFd_ < 0) {
        throw std::runtime_error(processError_.empty() ? "Codex app-server is not running." : processError_);
      }
    }

    sendJson(@{
      @"id": @(requestId),
      @"method": method,
      @"params": params,
    }, generation, cancellationGeneration, deadline);

    std::string responseLine;
    {
      std::unique_lock lock(mutex_);
      const bool received = condition_.wait_until(lock, deadline, [&]() {
        return responses_.contains(requestId) || processGeneration_ != generation ||
            (cancellationGeneration != UINT64_MAX && cancelGeneration_ != cancellationGeneration);
      });
      if (!received) {
        ignoredResponseIds_.insert(requestId);
        throw std::runtime_error("Codex app-server did not respond in time.");
      }
      if (cancellationGeneration != UINT64_MAX && cancelGeneration_ != cancellationGeneration) {
        throw std::runtime_error("Codex request was cancelled.");
      }
      if (processGeneration_ != generation && !responses_.contains(requestId)) {
        throw std::runtime_error(processError_.empty() ? "Codex app-server exited unexpectedly." : processError_);
      }
      responseLine = std::move(responses_[requestId]);
      responses_.erase(requestId);
    }
    return parseJsonObject(responseLine, "Codex app-server returned invalid JSON");
  }

  void sendNotification(NSString* method, uint64_t cancellationGeneration = UINT64_MAX, Clock::time_point deadline = Clock::time_point::max()) {
    uint64_t generation = 0;
    {
      std::lock_guard lock(mutex_);
      generation = processGeneration_;
    }
    sendJson(@{@"method": method}, generation, cancellationGeneration, deadline);
  }

  void interruptTurn(const std::string& threadId, const std::string& turnId, uint64_t expectedGeneration) {
    int64_t requestId = 0;
    uint64_t generation = 0;
    {
      std::lock_guard lock(mutex_);
      generation = processGeneration_;
      if (generation == 0 || generation != expectedGeneration || stdinFd_ < 0) {
        return;
      }
      requestId = nextRequestId_++;
      ignoredResponseIds_.insert(requestId);
    }
    @autoreleasepool {
      try {
        sendJson(@{
          @"id": @(requestId),
          @"method": @"turn/interrupt",
          @"params": @{
            @"threadId": toNSString(threadId),
            @"turnId": toNSString(turnId),
          },
        }, generation, UINT64_MAX, Clock::now() + std::chrono::milliseconds(100));
      } catch (...) {
      }
    }
  }

  void sendJson(NSDictionary* value, uint64_t generation, uint64_t expectedCancellationGeneration = UINT64_MAX, Clock::time_point deadline = Clock::time_point::max()) {
    std::string json = serializeJson(value);
    json.push_back('\n');
    uint64_t cancellationGeneration = 0;
    { std::lock_guard lock(mutex_); cancellationGeneration = expectedCancellationGeneration == UINT64_MAX ? cancelGeneration_ : expectedCancellationGeneration; }
    std::unique_lock writeLock(writeMutex_, std::defer_lock);
    const auto writeDeadline = std::min(deadline, Clock::now() + std::chrono::seconds(1));
    while (!writeLock.try_lock_for(std::chrono::milliseconds(10))) {
      { std::lock_guard lock(mutex_); if (generation != processGeneration_ || (cancellationGeneration != UINT64_MAX && cancelGeneration_ != cancellationGeneration)) throw std::runtime_error("Codex request was cancelled."); }
      if (Clock::now() >= writeDeadline) throw std::runtime_error("Timed out waiting to write to Codex app-server.");
    }
    int fd = -1;
    {
      std::lock_guard lock(mutex_);
      if (generation == 0 || generation != processGeneration_ || stdinFd_ < 0) {
        throw std::runtime_error(processError_.empty() ? "Codex app-server is not running." : processError_);
      }
      fd = fcntl(stdinFd_, F_DUPFD_CLOEXEC, 0);
      if (fd < 0) throw std::runtime_error("Could not duplicate Codex app-server input: " + std::string(strerror(errno)));
    }
    size_t offset = 0;
    bool reportedBlocked = false;
    try {
      while (offset < json.size()) {
        {
          std::lock_guard lock(mutex_);
          if (generation != processGeneration_ || (cancellationGeneration != UINT64_MAX && cancelGeneration_ != cancellationGeneration)) {
            throw std::runtime_error("Codex request was cancelled.");
          }
        }
        if (Clock::now() >= writeDeadline) throw std::runtime_error("Timed out writing to Codex app-server.");
        const ssize_t written = write(fd, json.data() + offset, json.size() - offset);
        if (written > 0) {
          offset += static_cast<size_t>(written);
        } else if (written < 0 && errno == EINTR) {
          continue;
        } else if (written < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
          if (!reportedBlocked) {
            std::lock_guard lock(mutex_);
            ++blockedWriteCount_;
            reportedBlocked = true;
          }
          pollfd descriptor{fd, POLLOUT, 0};
          poll(&descriptor, 1, 25);
        } else {
          throw std::runtime_error("Could not write to Codex app-server: " + std::string(strerror(errno)));
        }
      }
    } catch (...) {
      close(fd);
      if (reportedBlocked) { std::lock_guard lock(mutex_); --blockedWriteCount_; }
      if (offset > 0) terminateProcessGeneration(generation, "Codex app-server request write did not complete.");
      throw;
    }
    if (reportedBlocked) { std::lock_guard lock(mutex_); --blockedWriteCount_; }
    close(fd);
  }

  void readStdout(int fd, uint64_t generation) {
    std::string pending;
    char buffer[8192];
    while (true) {
      const ssize_t count = read(fd, buffer, sizeof(buffer));
      if (count > 0) {
        pending.append(buffer, static_cast<size_t>(count));
        if (pending.size() > kMaximumMessageBytes) {
          markProtocolFailure(generation, "Codex app-server sent a message that was too large.");
          break;
        }
        size_t newline = std::string::npos;
        while ((newline = pending.find('\n')) != std::string::npos) {
          std::string line = pending.substr(0, newline);
          pending.erase(0, newline + 1);
          if (!line.empty()) {
            handleMessage(line, generation);
          }
        }
      } else if (count < 0 && errno == EINTR) {
        continue;
      } else {
        break;
      }
    }
    close(fd);
  }

  void readStderr(int fd, uint64_t generation) {
    char buffer[4096];
    while (true) {
      const ssize_t count = read(fd, buffer, sizeof(buffer));
      if (count > 0) {
        std::lock_guard lock(mutex_);
        if (processGeneration_ == generation) {
          stderrTail_.append(buffer, static_cast<size_t>(count));
          if (stderrTail_.size() > kMaximumStderrBytes) {
            stderrTail_.erase(0, stderrTail_.size() - kMaximumStderrBytes);
          }
        }
      } else if (count < 0 && errno == EINTR) {
        continue;
      } else {
        break;
      }
    }
    close(fd);
  }

  void handleMessage(const std::string& line, uint64_t generation) {
    @autoreleasepool {
      NSDictionary* message = nil;
      try {
        message = parseJsonObject(line, "Codex app-server returned invalid JSON");
      } catch (const std::exception& error) {
        markProtocolFailure(generation, error.what());
        return;
      }

      id rawRequestId = message[@"id"];
      NSNumber* numericRequestId = [rawRequestId isKindOfClass:[NSNumber class]] ? rawRequestId : nil;
      const bool hasRequestId = numericRequestId != nil || [rawRequestId isKindOfClass:[NSString class]];
      NSString* method = stringValue(message[@"method"]);
      if (numericRequestId != nil && method == nil) {
        std::lock_guard lock(mutex_);
        if (processGeneration_ != generation) {
          return;
        }
        const int64_t identifier = numericRequestId.longLongValue;
        if (ignoredResponseIds_.erase(identifier) == 0) {
          responses_[identifier] = line;
        }
        condition_.notify_all();
        return;
      }
      if (method == nil) {
        return;
      }
      if (hasRequestId) {
        rejectServerRequest(rawRequestId, generation);
        return;
      }

      NSDictionary* params = dictionaryValue(message[@"params"]);
      if ([method isEqualToString:@"item/completed"]) {
        NSDictionary* item = dictionaryValue(params[@"item"]);
        if ([stringValue(item[@"type"]) isEqualToString:@"agentMessage"]) {
          const std::string turnId = toString(stringValue(params[@"turnId"]));
          const std::string text = toString(stringValue(item[@"text"]));
          std::lock_guard lock(mutex_);
          if (processGeneration_ == generation && !turnId.empty()) {
            if (TurnState* state = pendingOrActiveTurnLocked(turnId)) setPreAckTextLocked(*state, &TurnState::output, text);
          }
        }
      } else if ([method isEqualToString:@"error"]) {
        const std::string turnId = toString(stringValue(params[@"turnId"]));
        NSDictionary* error = dictionaryValue(params[@"error"]);
        const std::string errorMessage = toString(stringValue(error[@"message"]));
        const bool willRetry = boolValue(params[@"willRetry"]);
        std::lock_guard lock(mutex_);
        if (processGeneration_ == generation && !turnId.empty() && !willRetry) {
          if (TurnState* state = pendingOrActiveTurnLocked(turnId)) setPreAckTextLocked(*state, &TurnState::error, errorMessage);
        }
      } else if ([method isEqualToString:@"turn/completed"]) {
        NSDictionary* turn = dictionaryValue(params[@"turn"]);
        const std::string turnId = toString(stringValue(turn[@"id"]));
        const std::string status = toString(stringValue(turn[@"status"]));
        std::string output;
        for (id rawItem in arrayValue(turn[@"items"]) ?: @[]) {
          NSDictionary* item = dictionaryValue(rawItem);
          if ([stringValue(item[@"type"]) isEqualToString:@"agentMessage"]) {
            output = toString(stringValue(item[@"text"]));
          }
        }
        NSDictionary* error = dictionaryValue(turn[@"error"]);
        std::string errorMessage = toString(stringValue(error[@"message"]));
        if (errorMessage.empty() && status != "completed") {
          errorMessage = status.empty() ? "Codex turn failed." : "Codex turn " + status + ".";
        }
        std::lock_guard lock(mutex_);
        if (processGeneration_ == generation && !turnId.empty()) {
          TurnState* existing = pendingOrActiveTurnLocked(turnId); if (existing == nullptr) return;
          TurnState& state = *existing;
          if (!output.empty()) {
            setPreAckTextLocked(state, &TurnState::output, output);
          }
          setPreAckTextLocked(state, &TurnState::error, errorMessage);
          state.done = true;
          condition_.notify_all();
        }
      }
    }
  }

  void rejectServerRequest(id requestId, uint64_t generation) {
    @autoreleasepool {
      try {
        sendJson(@{
          @"error": @{
            @"code": @(-32601),
            @"message": @"Legend Apps does not support this Codex server request.",
          },
          @"id": requestId,
        }, generation);
      } catch (...) {
      }
    }
  }

  void markProtocolFailure(uint64_t generation, const std::string& message) {
    std::lock_guard lock(mutex_);
    if (processGeneration_ != generation) {
      return;
    }
    processError_ = actionableError(message);
    for (auto& [turnId, state] : turns_) {
      state.error = processError_;
      state.done = true;
    }
    condition_.notify_all();
  }

  void processExited(pid_t pid, uint64_t generation, int status) {
    std::lock_guard lock(mutex_);
    if (processGeneration_ != generation || pid_ != pid) {
      return;
    }
    if (stdinFd_ >= 0) {
      close(stdinFd_);
    }
    stdinFd_ = -1;
    pid_ = -1;
    initialized_ = false;
    processGeneration_ = 0;
    std::string detail;
    if (WIFEXITED(status)) {
      detail = "Codex app-server exited with status " + std::to_string(WEXITSTATUS(status)) + ".";
    } else if (WIFSIGNALED(status)) {
      detail = "Codex app-server stopped with signal " + std::to_string(WTERMSIG(status)) + ".";
    } else {
      detail = "Codex app-server exited unexpectedly.";
    }
    if (!stderrTail_.empty()) {
      detail += " " + stderrTail_;
    }
    processError_ = actionableError(detail);
    turns_.clear();
    preAckBytes_ = 0;
    pendingTurnStarts_ = 0;
    condition_.notify_all();
  }

  static void throwForResponseError(NSDictionary* response, const std::string& context) {
    const std::string error = responseError(response);
    if (!error.empty()) {
      throw std::runtime_error(actionableError(context + ": " + error));
    }
    if (dictionaryValue(response[@"result"]) == nil) {
      throw std::runtime_error(
          context + ": Codex returned an invalid response. Update Codex, then reopen the app.");
    }
  }

  std::condition_variable condition_;
  std::map<int64_t, std::string> responses_;
  std::set<int64_t> ignoredResponseIds_;
  std::set<pid_t> fallbackPids_;
  std::map<std::string, TurnState> turns_;
  std::set<std::string> retiredTurnIds_;
  std::deque<std::string> retiredTurnOrder_;
  std::timed_mutex lifecycleMutex_;
  std::mutex mutex_;
  std::timed_mutex writeMutex_;
  size_t activeRuns_ = 0;
  size_t blockedWriteCount_ = 0;
  size_t preAckBytes_ = 0;
  size_t pendingTurnStarts_ = 0;
  std::string codexPath_;
  std::string processError_;
  std::string stderrTail_;
  std::string userAgent_;
  int stdinFd_ = -1;
  int64_t nextRequestId_ = 1;
  pid_t pid_ = -1;
  uint64_t cancelGeneration_ = 0;
  uint64_t nextProcessGeneration_ = 0;
  uint64_t nextTurnSequence_ = 0;
  uint64_t processGeneration_ = 0;
  bool initialized_ = false;
  bool useExecFallback_ = false;
};

} // namespace

#if defined(SPARK_CODEX_TESTING)
extern "C" int SparkCodexTestRunPrompt(const char* prompt, double timeoutMs, char* output, size_t outputCapacity, char* error, size_t errorCapacity) {
  auto copy = [](char* target, size_t capacity, const std::string& value) {
    if (capacity == 0) return;
    const size_t length = std::min(capacity - 1, value.size());
    std::memcpy(target, value.data(), length); target[length] = '\0';
  };
  try {
    const auto result = CodexProcessSupervisor::shared().runPrompt(prompt ?: "", "", "low", timeoutMs, "", "");
    copy(output, outputCapacity, result.output);
    return 0;
  } catch (const std::exception& exception) { copy(error, errorCapacity, exception.what()); return 1; }
  catch (...) { copy(error, errorCapacity, "unknown native failure"); return 1; }
}
extern "C" double SparkCodexTestCancel() { return CodexProcessSupervisor::shared().cancelActiveRuns(); }
extern "C" double SparkCodexTestShutdown() { return CodexProcessSupervisor::shared().shutdown(); }
extern "C" size_t SparkCodexTestRetainedTurns() { return CodexProcessSupervisor::shared().retainedTurnCountForTesting(); }
extern "C" size_t SparkCodexTestBlockedWrites() { return CodexProcessSupervisor::shared().blockedWriteCountForTesting(); }
#else

HybridCodexAppServer::HybridCodexAppServer() : HybridObject(TAG) {}

std::shared_ptr<Promise<CodexAvailability>> HybridCodexAppServer::getAvailability() {
  return Promise<CodexAvailability>::async([]() {
    return CodexProcessSupervisor::shared().getAvailability();
  });
}

std::shared_ptr<Promise<CodexRunResult>> HybridCodexAppServer::runPrompt(
    const std::string& prompt,
    const std::string& cwd,
    const std::string& reasoningEffort,
    double timeoutMs,
    const std::string& outputSchemaJson,
    const std::string& developerInstructions) {
  return Promise<CodexRunResult>::async([
      prompt,
      cwd,
      reasoningEffort,
      timeoutMs,
      outputSchemaJson,
      developerInstructions]() {
    return CodexProcessSupervisor::shared().runPrompt(
        prompt,
        cwd,
        reasoningEffort,
        timeoutMs,
        outputSchemaJson,
        developerInstructions);
  });
}

double HybridCodexAppServer::cancelActiveRuns() {
  return CodexProcessSupervisor::shared().cancelActiveRuns();
}

double HybridCodexAppServer::shutdown() {
  return CodexProcessSupervisor::shared().shutdown();
}
#endif

} // namespace margelo::nitro::legendapps::codex
