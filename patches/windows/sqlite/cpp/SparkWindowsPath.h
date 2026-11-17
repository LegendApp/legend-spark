#pragma once
#include <filesystem>
#include <string>

inline std::filesystem::path SparkWindowsPath(std::string const &value) {
  return std::filesystem::path(std::u8string(value.begin(), value.end()));
}
