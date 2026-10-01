#pragma once
// Minimal, bounded loopback HTTP receiver. No Node runtime and no general server API.
#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "Ws2_32.lib")
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#endif
#include <atomic>
#include <chrono>
#include <functional>
#include <string>
#include <thread>
#include <stdexcept>
#include <algorithm>
#include <cctype>
namespace spark {
#ifdef _WIN32
using AuthSocket = SOCKET;
static constexpr AuthSocket InvalidSocket = INVALID_SOCKET;
inline void CloseSocket(AuthSocket fd) { closesocket(fd); }
#else
using AuthSocket = int;
static constexpr AuthSocket InvalidSocket = -1;
inline void CloseSocket(AuthSocket fd) { close(fd); }
#endif
class AuthLoopback {
  AuthSocket listener = InvalidSocket;
  std::atomic<bool> stopped{false};
  std::thread worker;
  std::function<void(std::string)> received;
  std::string route, origin;
  bool initialized = false;
  void Receive() {
    const auto expires = std::chrono::steady_clock::now() + std::chrono::minutes(10);
    while (!stopped && std::chrono::steady_clock::now() < expires) {
      fd_set sockets; FD_ZERO(&sockets); FD_SET(listener, &sockets); timeval wait{0, 100000};
      if (select(static_cast<int>(listener + 1), &sockets, nullptr, nullptr, &wait) <= 0) continue;
      AuthSocket client = accept(listener, nullptr, nullptr); if (client == InvalidSocket) continue;
#ifdef _WIN32
      DWORD timeout = 200; setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<char *>(&timeout), sizeof(timeout)); setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<char *>(&timeout), sizeof(timeout));
#else
      timeval timeout{0, 200000}; setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)); setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
      int noPipe = 1; setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &noPipe, sizeof(noPipe));
#endif
      std::string request; char buffer[1024];
      auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
      while (!stopped && request.size() < 8192 && request.find("\r\n\r\n") == std::string::npos && std::chrono::steady_clock::now() < deadline) {
        int count = recv(client, buffer, sizeof(buffer), 0); if (count <= 0) break; request.append(buffer, count);
      }
      bool valid = false;
      std::string target;
      auto first = request.find("\r\n");
      if (!stopped && request.size() <= 8192 && request.find("\r\n\r\n") != std::string::npos && request.starts_with("GET ") && first != std::string::npos) {
        auto end = request.find(' ', 4);
        if (end != std::string::npos && end < first) {
          target = request.substr(4, end - 4);
          const auto query = target.find('?');
          std::string headers = request.substr(first + 2);
          std::transform(headers.begin(), headers.end(), headers.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
          const auto host = std::string("host: ") + origin.substr(7) + "\r\n";
          valid = target.substr(0, query) == route && target.find('#') == std::string::npos &&
            (headers.starts_with(host) || headers.find("\r\n" + host) != std::string::npos) &&
            std::all_of(target.begin(), target.end(), [](unsigned char c) { return c > 32 && c < 127; }) &&
            (request.substr(end, first - end) == " HTTP/1.1" || request.substr(end, first - end) == " HTTP/1.0");
        }
      }
      const std::string body = valid ? "Callback received. You may return to the application." : "Invalid callback request.";
      const std::string response = std::string("HTTP/1.1 ") + (valid ? "200 OK" : "400 Bad Request") + "\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: " + std::to_string(body.size()) + "\r\n\r\n" + body;
      send(client, response.data(), static_cast<int>(response.size()), 0); CloseSocket(client);
      if (valid && !stopped) received(origin + target);
    }
    CloseSocket(listener); listener = InvalidSocket;
  }
 public:
  AuthLoopback(unsigned short port, std::string path, std::function<void(std::string)> callback) : received(std::move(callback)), route(std::move(path)) {
    if (!received) throw std::invalid_argument("Expected a callback listener");
    if (route.empty() || route[0] != '/' || route.find_first_not_of("/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_") != std::string::npos) throw std::invalid_argument("Invalid callback path");
#ifdef _WIN32
    WSADATA data{}; if (WSAStartup(MAKEWORD(2, 2), &data)) throw std::runtime_error("Could not initialize loopback socket"); initialized = true;
#endif
    try {
      listener = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP); if (listener == InvalidSocket) throw std::runtime_error("Could not create loopback socket");
#ifdef _WIN32
      BOOL exclusive = TRUE; setsockopt(listener, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, reinterpret_cast<char *>(&exclusive), sizeof(exclusive));
#endif
#ifndef _WIN32
      if (listener >= FD_SETSIZE) throw std::runtime_error("Loopback descriptor exceeds select capacity");
#endif
      sockaddr_in address{}; address.sin_family = AF_INET; address.sin_addr.s_addr = htonl(INADDR_LOOPBACK); address.sin_port = htons(port);
      if (bind(listener, reinterpret_cast<sockaddr *>(&address), sizeof(address)) != 0 || listen(listener, 8) != 0) throw std::runtime_error("Could not bind loopback callback port");
#ifdef _WIN32
      int size = sizeof(address);
#else
      socklen_t size = sizeof(address);
#endif
      if (getsockname(listener, reinterpret_cast<sockaddr *>(&address), &size) != 0) throw std::runtime_error("Could not read loopback port");
      origin = "http://127.0.0.1:" + std::to_string(ntohs(address.sin_port));
      worker = std::thread([this] { Receive(); });
    } catch (...) { if (listener != InvalidSocket) CloseSocket(listener);
#ifdef _WIN32
      if (initialized) WSACleanup();
#endif
      throw;
    }
  }
  ~AuthLoopback() { stopped = true; if (worker.joinable()) worker.join();
#ifdef _WIN32
    if (initialized) WSACleanup();
#endif
  }
  std::string RedirectURI() const { return origin + route; }
  AuthLoopback(AuthLoopback const &) = delete;
};
}
