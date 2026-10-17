// What the App Sandbox changes for the APIs Spark wraps (docs/app-sandbox.md), observed in a process the test signs ad
// hoc with the sandbox entitlements: tests/app-sandbox-native.test.ts. Prints one JSON object of facts.
#import <Foundation/Foundation.h>
#import <Carbon/Carbon.h>
#import <CoreServices/CoreServices.h>
#import "SparkSandbox.h"
#include <arpa/inet.h>
#include <dirent.h>
#include <spawn.h>
#include <sys/socket.h>
#include <sys/wait.h>

extern char **environ;

static NSString *Errno(int value) { return value ? @(strerror(value)) : @"ok"; }

// Runs /bin/sh -c `script` and returns its exit status and output.
static NSDictionary *Shell(NSString *script) {
  int pipes[2]; pipe(pipes);
  posix_spawn_file_actions_t actions; posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_adddup2(&actions, pipes[1], 1);
  posix_spawn_file_actions_adddup2(&actions, pipes[1], 2);
  posix_spawn_file_actions_addclose(&actions, pipes[0]);
  const char *argv[] = { "/bin/sh", "-c", script.UTF8String, NULL };
  pid_t pid = 0;
  int spawned = posix_spawn(&pid, "/bin/sh", &actions, NULL, (char *const *)argv, environ);
  posix_spawn_file_actions_destroy(&actions);
  close(pipes[1]);
  NSMutableData *output = [NSMutableData data];
  char buffer[4096]; ssize_t count;
  while ((count = read(pipes[0], buffer, sizeof buffer)) > 0) [output appendBytes:buffer length:(NSUInteger)count];
  close(pipes[0]);
  int status = 0;
  if (spawned == 0) waitpid(pid, &status, 0);
  return @{ @"spawn": Errno(spawned), @"status": @(WIFEXITED(status) ? WEXITSTATUS(status) : -1), @"output": [[NSString alloc] initWithData:output encoding:NSUTF8StringEncoding] ?: @"" };
}

int main(int argc, char **argv) {
  @autoreleasepool {
    if (argc < 3) { fprintf(stderr, "usage: app-sandbox <real home> <loopback port>\n"); return 2; }
    NSString *realHome = @(argv[1]);
    NSMutableDictionary *facts = [NSMutableDictionary dictionary];
    facts[@"sandboxed"] = @(SparkSandboxed());
    facts[@"home"] = NSHomeDirectory();
    facts[@"temporary"] = NSTemporaryDirectory();

    // Files: the container is the app's; the person's other files need their grant (an open panel or a bookmark).
    NSString *own = [NSTemporaryDirectory() stringByAppendingPathComponent:@"app-sandbox-probe.txt"];
    facts[@"writeOwn"] = [@"probe" writeToFile:own atomically:YES encoding:NSUTF8StringEncoding error:nil] ? @"ok" : @"failed";
    [NSFileManager.defaultManager removeItemAtPath:own error:nil];
    DIR *directory = opendir([realHome stringByAppendingPathComponent:@"Library/Preferences"].fileSystemRepresentation);
    facts[@"listOutside"] = Errno(directory ? 0 : errno);
    if (directory) closedir(directory);

    // Child processes inherit the sandbox: a system tool sees the container as its home and is denied the same files.
    facts[@"childHome"] = Shell(@"printf %s \"$HOME\"")[@"output"];
    NSDictionary *child = Shell([NSString stringWithFormat:@"/bin/ls '%@/Library/Preferences' >/dev/null", realHome]);
    facts[@"childListOutside"] = child[@"status"];

    // Network: outgoing connections need com.apple.security.network.client; listening needs network.server.
    int client = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in loopback = { .sin_len = sizeof loopback, .sin_family = AF_INET, .sin_port = htons((uint16_t)atoi(argv[2])) };
    loopback.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    facts[@"connect"] = Errno(connect(client, (struct sockaddr *)&loopback, sizeof loopback) == 0 ? 0 : errno);
    close(client);
    int server = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in any = { .sin_len = sizeof any, .sin_family = AF_INET, .sin_port = 0 };
    any.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    facts[@"listen"] = Errno(bind(server, (struct sockaddr *)&any, sizeof any) == 0 && listen(server, 1) == 0 ? 0 : errno);
    close(server);

    // Global shortcuts (@legendapp/spark/global-shortcuts) are Carbon hot keys: registered and removed at once.
    EventHotKeyRef hotKey = NULL;
    OSStatus registered = RegisterEventHotKey(kVK_F19, cmdKey | optionKey | controlKey | shiftKey, (EventHotKeyID){ 'SPRK', 1 }, GetApplicationEventTarget(), 0, &hotKey);
    facts[@"hotKey"] = @(registered);
    if (hotKey) UnregisterEventHotKey(hotKey);

    // Apple events: the automation permission, asked without a prompt. Finder always runs.
    AEAddressDesc finder = {};
    const char *identifier = "com.apple.finder";
    AECreateDesc(typeApplicationBundleID, identifier, (Size)strlen(identifier), &finder);
    facts[@"automation"] = @(AEDeterminePermissionToAutomateTarget(&finder, typeWildCard, typeWildCard, false));
    AEDisposeDesc(&finder);

    NSData *json = [NSJSONSerialization dataWithJSONObject:facts options:NSJSONWritingSortedKeys error:nil];
    fwrite(json.bytes, 1, json.length, stdout);
  }
  return 0;
}
