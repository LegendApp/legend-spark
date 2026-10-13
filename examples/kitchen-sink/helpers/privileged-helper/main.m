// The Kitchen Sink's privileged helper (docs/privileged-helper.md#writing-the-helper). It does nothing privileged: it
// answers every message with the message, whether the app sent admin rights that hold, and the uid it runs as (0 when
// launchd runs it as a daemon), so the manual flow can see the whole path work. Only the Kitchen Sink, signed by the same
// team, can connect. build.sh compiles it; nothing builds or embeds it unless the app opts in (e2e/flows/processes-ipc/
// privileged-helper-real.yaml).
#import "SparkPrivilegedHelperService.h"
#include <unistd.h>

int main(void)
{
  @autoreleasepool {
    return SparkPrivilegedHelperMain(@"so.legend.spark.examples.kitchensink.privileged-helper", @"so.legend.spark.examples.kitchensink",
      ^(id message, BOOL authorized, SparkPrivilegedHelperReply reply) { reply(@{ @"received": message, @"authorized": @(authorized), @"uid": @(getuid()) }, nil, nil); });
  }
}
