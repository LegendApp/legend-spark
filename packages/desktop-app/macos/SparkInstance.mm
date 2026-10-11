#import "SparkInstance.h"
#import <fcntl.h>
#import <signal.h>
#import <spawn.h>
#import <sys/event.h>
#import <sys/file.h>
#import <sys/socket.h>
#import <unistd.h>
#include <vector>

extern char **environ;
static const uint32_t SparkInstanceMaxPayload = 1 << 20;

static NSError *SparkPOSIXError(NSString *operation, int code) {
  return [NSError errorWithDomain:NSPOSIXErrorDomain code:code userInfo:@{
    NSLocalizedDescriptionKey: [NSString stringWithFormat:@"%@: %s", operation, strerror(code)] }];
}
static BOOL SparkFail(NSError **error, NSString *operation, int code) {
  if (error) *error = SparkPOSIXError(operation, code);
  return NO;
}
static int SparkOpenAt(int directory, NSString *name, NSString *suffix) {
  const char *path = [name stringByAppendingString:suffix].fileSystemRepresentation;
  int fd;
  // XNU can fail O_CREAT with ENOENT while another process creates the same file;
  // tests/app-instance-native.test.ts launches processes simultaneously to cover it.
  for (int attempt = 0; (fd = openat(directory, path, O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0600)) < 0 && errno == ENOENT && attempt < 16; attempt++) {}
  return fd;
}
// XNU accepts Unix-domain addresses up to SOCK_MAXADDRLEN, longer than the nominal
// 104-byte sun_path; sandbox container temporary paths need that room.
struct SparkSocketPath { uint8_t length; sa_family_t family; char path[SOCK_MAXADDRLEN - 2]; };
static BOOL SparkSocketAddress(NSString *directory, NSString *name, struct SparkSocketPath *address) {
  memset(address, 0, sizeof(*address));
  address->family = AF_UNIX;
  const char *path = [directory stringByAppendingPathComponent:[name stringByAppendingString:@".sock"]].fileSystemRepresentation;
  if (strlcpy(address->path, path, sizeof(address->path)) >= sizeof(address->path)) { errno = ENAMETOOLONG; return NO; }
  address->length = (uint8_t)(offsetof(struct SparkSocketPath, path) + strlen(path) + 1);
  return YES;
}
static int SparkSocket(NSTimeInterval timeout) {
  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) return -1;
  int one = 1;
  struct timeval limit = { (time_t)timeout, (suseconds_t)((timeout - (time_t)timeout) * 1e6) };
  if (fcntl(fd, F_SETFD, FD_CLOEXEC) || setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof(one))
      || (timeout > 0 && (setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &limit, sizeof(limit)) || setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &limit, sizeof(limit))))) {
    int code = errno; close(fd); errno = code; return -1;
  }
  return fd;
}
static BOOL SparkTransfer(int fd, void *bytes, size_t length, BOOL writing) {
  for (size_t done = 0; done < length;) {
    ssize_t count = writing ? write(fd, (char *)bytes + done, length - done) : read(fd, (char *)bytes + done, length - done);
    if (count > 0) done += (size_t)count;
    else if (count < 0 && errno == EINTR) continue;
    else { if (count == 0) errno = ECONNRESET; return NO; }
  }
  return YES;
}
static BOOL SparkStrings(id value) {
  if (![value isKindOfClass:NSArray.class]) return NO;
  for (id item in value) if (![item isKindOfClass:NSString.class]) return NO;
  return YES;
}
BOOL SparkInstanceValidLaunch(id launch) {
  return [launch isKindOfClass:NSDictionary.class] && SparkStrings(launch[@"arguments"]) && [launch[@"workingDirectory"] isKindOfClass:NSString.class]
    && SparkStrings(launch[@"files"]) && SparkStrings(launch[@"urls"]);
}

// Reads one length-prefixed launch, runs the receiver on the main queue, then acknowledges.
static void SparkServeConnection(int fd, SparkInstanceReceiver receiver) {
  uint32_t length = 0;
  NSMutableData *body = nil;
  if (SparkTransfer(fd, &length, sizeof(length), NO) && (length = ntohl(length)) > 0 && length <= SparkInstanceMaxPayload) {
    body = [NSMutableData dataWithLength:length];
    if (!SparkTransfer(fd, body.mutableBytes, length, NO)) body = nil;
  }
  id launch = body ? [NSJSONSerialization JSONObjectWithData:body options:0 error:nil] : nil;
  if (!SparkInstanceValidLaunch(launch)) { NSLog(@"Spark rejected a malformed forwarded launch"); close(fd); return; }
  dispatch_async(dispatch_get_main_queue(), ^{
    receiver(launch);
    uint8_t accepted = 1;
    SparkTransfer(fd, &accepted, 1, YES);
    close(fd);
  });
}

BOOL SparkInstanceAcquire(NSString *directory, NSString *name, SparkInstanceReceiver receiver, NSError **error) {
  if (error) *error = nil;
  int directoryFD = open(directory.fileSystemRepresentation, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (directoryFD < 0) return SparkFail(error, @"Unable to open the instance directory", errno);
  int setupFD = SparkOpenAt(directoryFD, name, @".setup");
  if (setupFD < 0 || flock(setupFD, LOCK_EX)) {
    int code = errno; if (setupFD >= 0) close(setupFD); close(directoryFD);
    return SparkFail(error, @"Unable to lock instance setup", code);
  }
  // Closing setupFD releases the setup lock on every path below.
  int lockFD = SparkOpenAt(directoryFD, name, @".lock");
  if (lockFD < 0) { int code = errno; close(setupFD); close(directoryFD); return SparkFail(error, @"Unable to open the instance lock", code); }
  if (flock(lockFD, LOCK_EX | LOCK_NB)) {
    int code = errno; close(lockFD); close(setupFD); close(directoryFD);
    return code == EWOULDBLOCK ? NO : SparkFail(error, @"Unable to take the instance lock", code);
  }
  struct SparkSocketPath address;
  int listenFD = -1;
  BOOL addressed = SparkSocketAddress(directory, name, &address);
  // Only the lock owner touches the socket path, so an existing one was left by a crashed owner.
  if (addressed) unlink(address.path);
  if (!addressed || (listenFD = SparkSocket(0)) < 0 || bind(listenFD, (struct sockaddr *)&address, address.length) || listen(listenFD, 16) || fcntl(listenFD, F_SETFL, O_NONBLOCK)) {
    int code = errno; if (listenFD >= 0) close(listenFD); close(lockFD); close(setupFD); close(directoryFD);
    return SparkFail(error, @"Unable to listen for forwarded launches", code);
  }
  close(directoryFD);
  dispatch_queue_t queue = dispatch_queue_create("spark.instance", DISPATCH_QUEUE_SERIAL);
  // Retained with the lock for the process lifetime.
  static dispatch_source_t source;
  source = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, (uintptr_t)listenFD, 0, queue);
  SparkInstanceReceiver handler = [receiver copy];
  dispatch_source_set_event_handler(source, ^{
    for (int client; (client = accept(listenFD, NULL, NULL)) >= 0;) {
      // The socket sits in the per-user temporary directory; also refuse peers running as another user.
      uid_t uid; gid_t gid;
      if (getpeereid(client, &uid, &gid) || uid != getuid()) { close(client); continue; }
      int one = 1; struct timeval limit = { 5, 0 };
      fcntl(client, F_SETFD, FD_CLOEXEC); fcntl(client, F_SETFL, 0);
      setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof(one));
      setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &limit, sizeof(limit));
      setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &limit, sizeof(limit));
      SparkServeConnection(client, handler);
    }
  });
  dispatch_resume(source);
  close(setupFD);
  return YES;
}

BOOL SparkInstanceForward(NSString *directory, NSString *name, NSDictionary *launch, NSTimeInterval timeout, NSError **error) {
  if (error) *error = nil;
  NSData *body = SparkInstanceValidLaunch(launch) ? [NSJSONSerialization dataWithJSONObject:launch options:0 error:nil] : nil;
  if (!body || body.length > SparkInstanceMaxPayload) return SparkFail(error, @"Invalid forwarded launch", EINVAL);
  struct SparkSocketPath address;
  int fd = -1;
  if (!SparkSocketAddress(directory, name, &address) || (fd = SparkSocket(timeout)) < 0 || connect(fd, (struct sockaddr *)&address, address.length)) {
    int code = errno; if (fd >= 0) close(fd);
    return SparkFail(error, @"The running instance is not accepting launches", code);
  }
  uint32_t size = htonl((uint32_t)body.length);
  uint8_t accepted = 0;
  BOOL sent = SparkTransfer(fd, &size, sizeof(size), YES) && SparkTransfer(fd, (void *)body.bytes, body.length, YES);
  BOOL acknowledged = sent && SparkTransfer(fd, &accepted, 1, NO) && accepted == 1;
  int code = errno;
  close(fd);
  return acknowledged ? YES : SparkFail(error, @"The running instance did not accept this launch", sent ? (code ?: EPROTO) : code);
}

pid_t SparkInstanceSpawnRelaunch(NSArray<NSString *> *arguments, NSError **error) {
  NSString *executable = NSBundle.mainBundle.executablePath;
  if (!executable) { SparkFail(error, @"Unable to find this executable", ENOENT); return 0; }
  NSMutableArray<NSString *> *argv = [NSMutableArray arrayWithObject:executable];
  [argv addObjectsFromArray:arguments];
  NSString *parent = [NSString stringWithFormat:@"SPARK_RELAUNCH_PARENT=%d", getpid()];
  NSMutableArray<NSString *> *environment = [NSMutableArray arrayWithObject:parent];
  for (char **item = environ; *item; item++) if (strncmp(*item, "SPARK_RELAUNCH_PARENT=", 22)) [environment addObject:@(*item)];
  std::vector<char *> args, env;
  for (NSString *value in argv) args.push_back(strdup(value.UTF8String));
  for (NSString *value in environment) env.push_back(strdup(value.UTF8String));
  args.push_back(nullptr); env.push_back(nullptr);
  posix_spawnattr_t attributes; posix_spawn_file_actions_t actions;
  posix_spawnattr_init(&attributes); posix_spawn_file_actions_init(&actions);
  sigset_t none, all; sigemptyset(&none); sigfillset(&all);
  // Only stdio is inherited: the instance lock and handoff socket stay with this process.
  posix_spawnattr_setflags(&attributes, POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_SETSIGMASK | POSIX_SPAWN_SETSIGDEF);
  posix_spawnattr_setsigmask(&attributes, &none); posix_spawnattr_setsigdefault(&attributes, &all);
  for (int fd = 0; fd <= 2; fd++) posix_spawn_file_actions_addinherit_np(&actions, fd);
  pid_t child = 0;
  int code = posix_spawn(&child, args[0], &actions, &attributes, args.data(), env.data());
  posix_spawn_file_actions_destroy(&actions); posix_spawnattr_destroy(&attributes);
  for (char *value : args) free(value);
  for (char *value : env) free(value);
  if (code) { SparkFail(error, @"Unable to start the relaunched instance", code); return 0; }
  return child;
}

BOOL SparkInstanceWaitForExit(pid_t pid, NSError **error) {
  int queue = kqueue();
  if (queue < 0) return SparkFail(error, @"Unable to wait for the previous instance", errno);
  struct kevent change, event;
  EV_SET(&change, pid, EVFILT_PROC, EV_ADD | EV_ONESHOT | EV_RECEIPT, NOTE_EXIT, 0, NULL);
  int count;
  while ((count = kevent(queue, &change, 1, &event, 1, NULL)) < 0 && errno == EINTR) {}
  if (count < 0) { int code = errno; close(queue); return SparkFail(error, @"Unable to wait for the previous instance", code); }
  // EV_RECEIPT reports registration; ESRCH means the process has already exited.
  if ((event.flags & EV_ERROR) && event.data) { close(queue); return event.data == ESRCH ? YES : SparkFail(error, @"Unable to wait for the previous instance", (int)event.data); }
  while ((count = kevent(queue, NULL, 0, &event, 1, NULL)) < 0 && errno == EINTR) {}
  int code = errno;
  close(queue);
  return count == 1 ? YES : SparkFail(error, @"Unable to wait for the previous instance", code);
}
