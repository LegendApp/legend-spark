// Spark launch forwarding and relaunch helpers for the Win32 host. Standard C++ only:
// tests/windows-launch.native.cpp compiles this file on any host.
#include <string>
#include <vector>
namespace SparkLaunch {
constexpr wchar_t SafeModeFlag[] = L"--spark-safe-mode";
constexpr wchar_t RelaunchParent[] = L"SPARK_RELAUNCH_PARENT";

// WM_COPYDATA payload: working directory, NUL, command line, NUL.
inline std::wstring EncodeForward(std::wstring const &directory, std::wstring const &commandLine) {
  std::wstring payload = directory; payload.push_back(L'\0'); payload += commandLine; payload.push_back(L'\0');
  return payload;
}
inline bool DecodeForward(wchar_t const *data, size_t count, std::wstring &directory, std::wstring &commandLine) {
  if (!data || count < 2 || data[count - 1] != L'\0') return false;
  std::wstring payload(data, count - 1);
  auto separator = payload.find(L'\0');
  if (separator == std::wstring::npos || payload.find(L'\0', separator + 1) != std::wstring::npos) return false;
  directory = payload.substr(0, separator); commandLine = payload.substr(separator + 1);
  return !directory.empty() && !commandLine.empty();
}

enum class Target { None, File, Url };
// Shell associations pass absolute paths and protocol activations pass URLs; flags and
// relative arguments stay in `arguments` for the app to interpret.
inline Target Classify(std::wstring const &argument) {
  if (argument.empty() || argument[0] == L'-') return Target::None;
  auto letter = [](wchar_t c) { return (c >= L'a' && c <= L'z') || (c >= L'A' && c <= L'Z'); };
  if (argument.size() >= 3 && letter(argument[0]) && argument[1] == L':' && (argument[2] == L'\\' || argument[2] == L'/')) return Target::File;
  if (argument.rfind(L"\\\\", 0) == 0) return Target::File;
  auto colon = argument.find(L':');
  if (colon == std::wstring::npos || colon < 2 || !letter(argument[0])) return Target::None;
  for (size_t i = 1; i < colon; ++i) if (!letter(argument[i]) && !(argument[i] >= L'0' && argument[i] <= L'9') && argument[i] != L'+' && argument[i] != L'-' && argument[i] != L'.') return Target::None;
  return Target::Url;
}

// Quotes one argument so CommandLineToArgvW and the CRT parse it back unchanged.
inline std::wstring QuoteArgument(std::wstring const &argument) {
  if (!argument.empty() && argument.find_first_of(L" \t\n\v\"") == std::wstring::npos) return argument;
  std::wstring quoted = L"\"";
  for (auto it = argument.begin();; ++it) {
    size_t slashes = 0;
    while (it != argument.end() && *it == L'\\') { ++it; ++slashes; }
    if (it == argument.end()) { quoted.append(slashes * 2, L'\\'); break; }
    if (*it == L'"') { quoted.append(slashes * 2 + 1, L'\\'); quoted.push_back(L'"'); }
    else { quoted.append(slashes, L'\\'); quoted.push_back(*it); }
  }
  quoted.push_back(L'"');
  return quoted;
}
inline std::wstring CommandLine(std::wstring const &executable, std::vector<std::wstring> const &arguments) {
  std::wstring line = QuoteArgument(executable);
  for (auto const &argument : arguments) { line.push_back(L' '); line += QuoteArgument(argument); }
  return line;
}
// Reuses arguments after the executable, excluding the safe-mode launch flag.
inline std::vector<std::wstring> RelaunchArguments(std::vector<std::wstring> const &process) {
  std::vector<std::wstring> arguments;
  for (size_t i = 1; i < process.size(); ++i) if (process[i] != SafeModeFlag) arguments.push_back(process[i]);
  return arguments;
}
// `flag`, `modifier` or empty for a normal launch.
inline std::wstring SafeModeTrigger(std::vector<std::wstring> const &arguments, bool shiftHeld) {
  for (size_t i = 1; i < arguments.size(); ++i) if (arguments[i] == SafeModeFlag) return L"flag";
  return shiftHeld ? L"modifier" : L"";
}
}
