// Compiles SparkSystem's portable taskbar helpers (packages/system/windows/SparkSystem/taskbar.inc) on any host.
#include <cstdio>
#include <cstdlib>
#include "../packages/system/windows/SparkSystem/taskbar.inc"
using namespace SparkTaskbar;
static void check(bool value, const char *message) { if (!value) { std::fprintf(stderr, "%s\n", message); std::exit(1); } }
int main() {
  Progress state = Progress::Normal;
  check(ParseProgress(L"none", state) && state == Progress::None && !HasValue(state), "none clears progress without a value");
  check(ParseProgress(L"indeterminate", state) && state == Progress::Indeterminate && !HasValue(state), "indeterminate has no value");
  check(ParseProgress(L"normal", state) && state == Progress::Normal && HasValue(state), "normal has a value");
  check(ParseProgress(L"paused", state) && state == Progress::Paused && HasValue(state), "paused has a value");
  check(ParseProgress(L"error", state) && state == Progress::Error && HasValue(state), "error has a value");
  check(!ParseProgress(L"Normal", state) && !ParseProgress(L"", state) && state == Progress::Error, "unknown states are rejected and leave the result");
  check(int(Progress::None) == 0 && int(Progress::Indeterminate) == 1 && int(Progress::Normal) == 2 && int(Progress::Error) == 4 && int(Progress::Paused) == 8, "states are TBPFLAG values");
  check(ProgressCompleted(0) == 0 && ProgressCompleted(1) == ProgressTotal && ProgressCompleted(0.35) == 3500 && ProgressCompleted(0.12345) == 1235, "values scale to ten thousand steps");
  check(ProgressCompleted(-1) == 0 && ProgressCompleted(2) == ProgressTotal && ProgressCompleted(0.0 / 0.0) == 0, "out-of-range values clamp");
  check(BadgeCountText(0).empty() && BadgeCountText(7) == L"7" && BadgeCountText(99) == L"99" && BadgeCountText(100) == L"99+" && BadgeCountText(123456) == L"99+", "counts fit the overlay");
  check(BadgeFontHeight(1) == 20 && BadgeFontHeight(2) == 20 && BadgeFontHeight(3) == 14 && BadgeFontHeight(8) == 11, "longer labels get smaller fonts");
  std::puts("Windows taskbar helper tests passed");
}
