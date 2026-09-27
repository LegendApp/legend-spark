#import <Foundation/Foundation.h>

// A false result with no error means conflict/absence respectively.
BOOL SparkWriteTextIfUnchanged(NSURL *url, NSString *expected, NSString *text, NSError **error);
BOOL SparkRemoveFile(NSURL *url, BOOL recursive, NSError **error);
