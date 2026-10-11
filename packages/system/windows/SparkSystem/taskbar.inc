// Taskbar progress and overlay badge helpers for SparkSystem. Standard C++ only:
// tests/windows-taskbar.native.cpp compiles this file on any host.
#include <cmath>
#include <cstdint>
#include <string>
namespace SparkTaskbar {
// TBPFLAG values from shobjidl.h; SparkSystem.h checks they match.
enum class Progress : int { None = 0, Indeterminate = 1, Normal = 2, Error = 4, Paused = 8 };
// SetProgressValue takes completed/total; ten thousand steps are finer than any taskbar button.
constexpr uint64_t ProgressTotal = 10000;

inline bool ParseProgress(std::wstring const &state, Progress &result) {
  if (state == L"none") result = Progress::None;
  else if (state == L"indeterminate") result = Progress::Indeterminate;
  else if (state == L"normal") result = Progress::Normal;
  else if (state == L"paused") result = Progress::Paused;
  else if (state == L"error") result = Progress::Error;
  else return false;
  return true;
}
inline bool HasValue(Progress progress) { return progress == Progress::Normal || progress == Progress::Paused || progress == Progress::Error; }
inline uint64_t ProgressCompleted(double value) {
  if (!(value > 0)) return 0;
  if (value >= 1) return ProgressTotal;
  return static_cast<uint64_t>(std::llround(value * ProgressTotal));
}

// The 32-pixel overlay fits two digits, so larger counts show 99+, as Windows app badges do.
inline std::wstring BadgeCountText(uint64_t count) { return count == 0 ? L"" : count > 99 ? L"99+" : std::to_wstring(count); }
// Pixel height for CreateFontW (passed negated) that fits `length` characters in the overlay.
inline int BadgeFontHeight(size_t length) { return length <= 2 ? 20 : length == 3 ? 14 : 11; }
}
