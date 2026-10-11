// Compiles the Win32 host's portable launch helpers (packages/desktop-host/windows/launch.inc) on any host.
#include <cstdio>
#include <cstdlib>
#include "../packages/desktop-host/windows/launch.inc"
using namespace SparkLaunch;
static void check(bool value, const char *message) { if (!value) { std::fprintf(stderr, "%s\n", message); std::exit(1); } }
int main() {
  auto payload = EncodeForward(L"C:\\Work", L"app.exe \"C:\\a b.txt\"");
  std::wstring directory, commandLine;
  check(DecodeForward(payload.data(), payload.size(), directory, commandLine) && directory == L"C:\\Work" && commandLine == L"app.exe \"C:\\a b.txt\"", "Forward payload round-trips");
  check(!DecodeForward(payload.data(), payload.size() - 1, directory, commandLine), "An unterminated payload is rejected");
  std::wstring legacy = L"app.exe x"; legacy.push_back(L'\0');
  check(!DecodeForward(legacy.data(), legacy.size(), directory, commandLine), "A payload without a working directory is rejected");
  std::wstring extra = payload; extra.insert(extra.size() - 1, std::wstring(1, L'\0') + L"x");
  check(!DecodeForward(extra.data(), extra.size(), directory, commandLine), "A payload with an extra field is rejected");
  check(!DecodeForward(nullptr, 0, directory, commandLine), "An empty payload is rejected");

  check(Classify(L"C:\\Users\\a\\notes.md") == Target::File && Classify(L"d:/x") == Target::File && Classify(L"\\\\server\\share\\f") == Target::File, "Absolute paths are files");
  check(Classify(L"spark-ks://area/screen") == Target::Url && Classify(L"mailto:a@b.c") == Target::Url && Classify(L"web+app:x") == Target::Url, "Schemes are URLs");
  check(Classify(L"--flag") == Target::None && Classify(L"-x") == Target::None && Classify(L"notes.md") == Target::None && Classify(L"") == Target::None, "Flags and relative arguments are neither");
  check(Classify(L"C:relative") == Target::None && Classify(L"1x:y") == Target::None && Classify(L"a b:c") == Target::None, "Drive-relative paths and invalid schemes are neither");

  // Expected forms follow the CommandLineToArgvW parsing rules.
  check(QuoteArgument(L"plain") == L"plain", "Plain arguments are unquoted");
  check(QuoteArgument(L"") == L"\"\"", "An empty argument is quoted");
  check(QuoteArgument(L"a b") == L"\"a b\"", "Spaces are quoted");
  check(QuoteArgument(L"say \"hi\"") == L"\"say \\\"hi\\\"\"", "Quotes are escaped");
  check(QuoteArgument(L"C:\\Program Files\\") == L"\"C:\\Program Files\\\\\"", "Trailing backslashes double before the closing quote");
  check(QuoteArgument(L"a\\\\\"b c") == L"\"a\\\\\\\\\\\"b c\"", "Backslashes before a quote double and escape it");
  check(QuoteArgument(L"C:\\a\\b") == L"C:\\a\\b", "Interior backslashes are literal");
  check(CommandLine(L"C:\\App\\app.exe", {L"--spark-safe-mode", L"x y"}) == L"C:\\App\\app.exe --spark-safe-mode \"x y\"", "Command lines join quoted arguments");

  check(SafeModeTrigger({L"app.exe", L"--spark-safe-mode"}, false) == L"flag", "The flag selects safe mode");
  check(SafeModeTrigger({L"app.exe", L"--spark-safe-mode"}, true) == L"flag", "The flag wins over the modifier");
  check(SafeModeTrigger({L"app.exe"}, true) == L"modifier", "Shift selects safe mode");
  check(SafeModeTrigger({L"--spark-safe-mode"}, false).empty(), "The executable path is not a flag");
  check(SafeModeTrigger({L"app.exe", L"x"}, false).empty(), "A normal launch is not safe mode");
  std::puts("Windows launch helper tests passed");
}
