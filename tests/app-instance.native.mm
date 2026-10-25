// Process roles for tests/app-instance-native.test.ts, which runs several of these at once.
//   launch <dir> <name> <tag> <holdSeconds>  own the instance and print received launches, or forward one
//   relaunch <dir> <name> approve|veto        own the instance, start a relaunch child, then exit or kill it
//   malformed <dir> <name>                    send an invalid payload to the owner
//   validate                                  payload validation and wait-for-exit edge cases
#import "SparkInstance.h"
#import <signal.h>
#import <sys/socket.h>
#import <sys/un.h>
#import <sys/wait.h>
#import <unistd.h>

static void say(NSString *line) { printf("%s\n", line.UTF8String); fflush(stdout); }
static void check(BOOL value, NSString *message) { if (!value) { fprintf(stderr, "%s\n", message.UTF8String); exit(1); } }
static NSString *json(id value) { return [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:nil] encoding:NSUTF8StringEncoding]; }
static void serve(NSString *tag, double seconds) {
  say([@"PRIMARY " stringByAppendingString:tag]);
  [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:seconds]];
  exit(0);
}
static BOOL acquire(NSString *directory, NSString *name) {
  NSError *error;
  BOOL owner = SparkInstanceAcquire(directory, name, ^(NSDictionary *launch) {
    check(NSThread.isMainThread, @"Receivers run on the main thread");
    say([@"LAUNCH " stringByAppendingString:json(launch)]);
  }, &error);
  check(!error, [@"Acquire failed: " stringByAppendingString:error.localizedDescription ?: @""]);
  return owner;
}

int main(int argc, char **argv) { @autoreleasepool {
  NSString *role = argc > 1 ? @(argv[1]) : @"";
  if ([role isEqual:@"validate"]) {
    check([SparkInstanceRelaunchArguments(@[@"app", @"--spark-safe-mode", @"file.txt", @"--spark-safe-mode", @"--other"]) isEqual:@[@"file.txt", @"--other"]], @"Default relaunch leaves safe mode and preserves other arguments");
    check(SparkInstanceRelaunchArguments(@[@"app"]).count == 0, @"No arguments remain omitted");
    check(SparkInstanceValidLaunch(@{ @"arguments": @[@"a"], @"workingDirectory": @"/", @"files": @[], @"urls": @[] }), @"A complete launch is valid");
    for (id launch in @[@[], @{}, @{ @"arguments": @[@1], @"workingDirectory": @"/", @"files": @[], @"urls": @[] },
        @{ @"arguments": @[], @"workingDirectory": @1, @"files": @[], @"urls": @[] }, @{ @"arguments": @[], @"workingDirectory": @"/", @"files": @"x", @"urls": @[] },
        @{ @"arguments": @[], @"workingDirectory": @"/", @"files": @[] }])
      check(!SparkInstanceValidLaunch(launch), [@"Rejects " stringByAppendingString:[launch description]]);
    NSError *error;
    check(!SparkInstanceForward(NSTemporaryDirectory(), @"spark.test.absent", @{}, 1, &error) && error.code == EINVAL, @"An invalid launch is never sent");
    check(!SparkInstanceForward(NSTemporaryDirectory(), @"spark.test.absent", @{ @"arguments": @[], @"workingDirectory": @"/", @"files": @[], @"urls": @[] }, 1, &error) && error, @"Forwarding without an owner fails");
    pid_t child = fork();
    if (!child) _exit(0);
    waitpid(child, NULL, 0);
    check(SparkInstanceWaitForExit(child, &error), @"Waiting for an exited process returns at once");
    say(@"VALID");
    return 0;
  }
  check(argc >= 4, @"Usage: <role> <dir> <name> ...");
  NSString *directory = @(argv[2]), *name = @(argv[3]);
  if ([role isEqual:@"launch"]) {
    NSString *tag = @(argv[4]);
    double hold = atof(argv[5]);
    NSString *parent = NSProcessInfo.processInfo.environment[@"SPARK_RELAUNCH_PARENT"];
    if (parent) {
      // The same handoff as SparkAcquireInstance: wait for the previous owner, then take the lock.
      unsetenv("SPARK_RELAUNCH_PARENT");
      NSError *error;
      check(SparkInstanceWaitForExit(parent.intValue, &error), @"Wait for the previous owner");
      check(kill(parent.intValue, 0) != 0, @"The previous owner has exited");
      say([@"RELAUNCHED " stringByAppendingString:tag]);
    }
    if (acquire(directory, name)) serve(tag, hold);
    NSError *error;
    NSDictionary *launch = @{ @"arguments": @[@"app", tag], @"workingDirectory": @"/tmp", @"files": @[[@"/tmp/" stringByAppendingString:tag]], @"urls": @[[@"spark-test://open/" stringByAppendingString:tag]] };
    check(SparkInstanceForward(directory, name, launch, 10, &error), [@"Forward failed: " stringByAppendingString:error.localizedDescription ?: @""]);
    say([@"FORWARDED " stringByAppendingString:tag]);
    return 0;
  }
  if ([role isEqual:@"relaunch"]) {
    check(acquire(directory, name), @"The relauncher owns the instance");
    say(@"PRIMARY relauncher");
    NSError *error;
    pid_t child = SparkInstanceSpawnRelaunch(@[@"launch", directory, name, @"child", @"1"], &error);
    check(child > 0, [@"Spawn failed: " stringByAppendingString:error.localizedDescription ?: @""]);
    check(!NSProcessInfo.processInfo.environment[@"SPARK_RELAUNCH_PARENT"], @"The parent environment is unchanged");
    if ([@(argv[4]) isEqual:@"veto"]) {
      [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.3]];
      kill(child, SIGKILL);
      int status = 0;
      check(waitpid(child, &status, 0) == child && WIFSIGNALED(status), @"A vetoed relaunch child is killed while waiting");
      serve(@"vetoed", 3);
    }
    say(@"EXITING");
    return 0;
  }
  if ([role isEqual:@"malformed"]) {
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    struct sockaddr_un address = { .sun_family = AF_UNIX };
    snprintf(address.sun_path, sizeof(address.sun_path), "%s/%s.sock", directory.fileSystemRepresentation, name.UTF8String);
    check(connect(fd, (struct sockaddr *)&address, (socklen_t)SUN_LEN(&address)) == 0, @"Connect to the owner");
    const char body[] = "{\"arguments\":\"not-an-array\"}";
    uint32_t length = htonl(sizeof(body) - 1);
    write(fd, &length, sizeof(length)); write(fd, body, sizeof(body) - 1);
    uint8_t reply = 0;
    check(read(fd, &reply, 1) == 0, @"The owner closes a malformed launch without acknowledging it");
    say(@"REJECTED");
    return 0;
  }
  check(NO, [@"Unknown role " stringByAppendingString:role]);
} }
