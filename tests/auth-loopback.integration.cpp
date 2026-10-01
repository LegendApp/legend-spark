#include "../packages/desktop-links/common/AuthLoopback.h"
#include <iostream>
int main() {
  spark::AuthLoopback callback(0, "/auth/callback", [](std::string url) { std::cout << url << std::endl; });
  std::cout << callback.RedirectURI() << std::endl;
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line == "quit") return 0;
  }
}
