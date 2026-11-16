const path = require('node:path');
const { createRequire } = require('node:module');

// A Windows process can hold only about 8,000 open files. A warm-cache bundle or reload asks Metro's cache for
// every module at once (4,466 reads were in flight in the Kitchen Sink, and up to the 8,000 limit as the graph grows), so a reload hit EMFILE, also failing any
// other file read in the process meanwhile. Bound the reads on metro-cache's FileStore itself: Expo, uniwind and
// other Metro configs replace `cacheStores`, but their stores all extend it.
function limitConcurrency(limit) {
  let active = 0;
  const waiting = [];
  return async task => {
    if (active >= limit) await new Promise(resolve => waiting.push(resolve));
    active++;
    try { return await task(); } finally { active--; waiting.shift()?.(); }
  };
}
function limitFileStore(FileStore, limit = 2048) {
  const { get, set } = FileStore.prototype;
  if (get.sparkLimited) return;
  const run = limitConcurrency(limit);
  FileStore.prototype.get = function (key) { return run(() => get.call(this, key)); };
  FileStore.prototype.set = function (key, value) { return run(() => set.call(this, key, value)); };
  FileStore.prototype.get.sparkLimited = true;
}
function installMetroCacheLimit(root) {
  let FileStore;
  try { FileStore = createRequire(path.join(root, 'package.json'))('metro-cache/private/stores/FileStore'); } catch { return false; }
  limitFileStore(FileStore.default ?? FileStore);
  return true;
}
module.exports = { limitConcurrency, limitFileStore, installMetroCacheLimit };
