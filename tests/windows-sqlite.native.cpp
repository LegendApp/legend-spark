#include "SparkWindowsPath.h"
#include <cassert>
#include <fstream>

int main(int argc, char **argv) {
  assert(argc == 2);
  std::u8string unicode = u8"目录/数据库-😀.sqlite";
  std::string bytes(unicode.begin(), unicode.end());
  auto relative = SparkWindowsPath(bytes);
  assert(relative.u8string() == unicode);
  auto file = std::filesystem::path(argv[1]) / relative;
  std::filesystem::create_directories(file.parent_path());
  { std::ofstream output(file); output << "unicode path"; }
  std::ifstream input(file);
  std::string value;
  std::getline(input, value);
  assert(value == "unicode path");
  assert(std::filesystem::remove(file));
}
