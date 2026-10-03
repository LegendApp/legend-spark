#import <Foundation/Foundation.h>
#include <chrono>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <string>
#include <thread>

extern "C" int SparkCodexTestRunPrompt(const char*, double, char*, size_t, char*, size_t);
extern "C" double SparkCodexTestCancel();
extern "C" double SparkCodexTestShutdown();
extern "C" size_t SparkCodexTestRetainedTurns();
extern "C" size_t SparkCodexTestBlockedWrites();

static bool waitForMarker(const std::string& expected) {
  const char* path = std::getenv("CODEX_TEST_MARKER");
  if (path == nullptr) return false;
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
  while (std::chrono::steady_clock::now() < deadline) {
    std::ifstream file(path);
    std::string value;
    file >> value;
    if (value == expected) return true;
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  return false;
}

int main(int argc, char** argv) {
  const size_t promptSize = argc > 1 && (std::string(argv[1]) == "stall" || std::string(argv[1]) == "write-restart" || std::string(argv[1]) == "cancel-restart") ? 32 * 1024 * 1024 : 16;
  const std::string mode = argc > 1 ? argv[1] : "stall";
  std::string prompt(promptSize, 'x');
  char output[128] = {};
  char error[512] = {};
  int result = -1;
  std::thread run([&] { result = SparkCodexTestRunPrompt(prompt.c_str(), 5000, output, sizeof(output), error, sizeof(error)); });
  if (mode == "preack" || mode == "postack") {
    run.join();
    std::cout << "result=" << result << " output=" << output << " error=" << error << "\n";
    return result == 0 ? 0 : 1;
  }
  if (mode == "oversize-preack") {
    run.join();
    std::cout << "result=" << result << " error=" << error << "\n";
    return result != 0 && std::string(error).find("16 MiB pre-ack") != std::string::npos ? 0 : 1;
  }
  if (mode == "late" || mode == "restart") {
    run.join();
    if (result != 0) return 1;
    if (mode == "late") {
      std::this_thread::sleep_for(std::chrono::milliseconds(400));
      const size_t retained = SparkCodexTestRetainedTurns();
      std::cout << "retained=" << retained << "\n";
      SparkCodexTestShutdown();
      return retained == 0 ? 0 : 1;
    }
    SparkCodexTestShutdown();
    result = SparkCodexTestRunPrompt(prompt.c_str(), 5000, output, sizeof(output), error, sizeof(error));
    std::cout << "restart_result=" << result << " output=" << output << " error=" << error << "\n";
    SparkCodexTestShutdown();
    return result == 0 ? 0 : 1;
  }
  if (mode == "write-restart") {
    run.join();
    if (result == 0 || std::string(error).find("Timed out writing") == std::string::npos) {
      std::cout << "first_result=" << result << " first_error=" << error << "\n";
      return 1;
    }
    error[0] = '\0';
    result = SparkCodexTestRunPrompt("retry", 5000, output, sizeof(output), error, sizeof(error));
    std::cout << "first_error=" << error << " retry_result=" << result << " output=" << output << "\n";
    SparkCodexTestShutdown();
    return result == 0 ? 0 : 1;
  }
  if (mode == "cancel-restart") {
    const bool blocked = mode == "cancel-restart" ? [&] { const auto end = std::chrono::steady_clock::now() + std::chrono::seconds(5); while (std::chrono::steady_clock::now() < end) { if (SparkCodexTestBlockedWrites() > 0) return true; std::this_thread::sleep_for(std::chrono::milliseconds(10)); } return false; }() : false;
    if (!blocked) return 1;
    const double cancelled = SparkCodexTestCancel();
    run.join();
    if (result == 0 || std::string(error).find("cancelled") == std::string::npos || cancelled != 1) return 1;
    error[0] = '\0';
    result = SparkCodexTestRunPrompt("retry", 5000, output, sizeof(output), error, sizeof(error));
    std::cout << "cancelled=" << cancelled << " retry_result=" << result << " output=" << output << " error=" << error << "\n";
    SparkCodexTestShutdown();
    return result == 0 ? 0 : 1;
  }
  const std::string stage = mode == "stall" ? "blocked" : mode == "cancel-init" ? "initialize" : mode == "cancel-thread" ? "thread" : "turn";
  if (!waitForMarker(stage)) return 1;
  if (mode == "stall") {
    const auto end = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    while (std::chrono::steady_clock::now() < end && SparkCodexTestBlockedWrites() == 0) std::this_thread::sleep_for(std::chrono::milliseconds(10));
    if (SparkCodexTestBlockedWrites() == 0) return 1;
  }
  const auto start = std::chrono::steady_clock::now();
  const double cancelled = SparkCodexTestCancel();
  const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count();
  run.join();
  std::cout << "cancelled=" << cancelled << " elapsed_ms=" << elapsed << " result=" << result << " error=" << error << "\n";
  return elapsed < 500 && result != 0 ? 0 : 1;
}
