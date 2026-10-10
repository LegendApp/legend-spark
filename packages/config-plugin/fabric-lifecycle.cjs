// Compatibility fix for the pinned RN macOS Fabric start/stop race.
// Keep the native lifecycle replacement explicit and fail on changed upstream code.
const fs = require("node:fs");
const path = require("node:path");
const originalLifecycle = `- (void)start
{
  std::lock_guard<std::mutex> lock(_surfaceMutex);

  if (_surfaceHandler->getStatus() != SurfaceHandler::Status::Registered) {
    return;
  }

  // We need to register a root view component here synchronously because right after
  // we start a surface, it can initiate an update that can query the root component.
  RCTExecuteOnMainQueue(^{
    [self->_surfacePresenter.mountingManager attachSurfaceToView:self.view
                                                       surfaceId:self->_surfaceHandler->getSurfaceId()];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE, 0), ^{
      self->_surfaceHandler->start();
      [self _propagateStageChange];

      [self->_surfacePresenter setupAnimationDriverWithSurfaceHandler:*self->_surfaceHandler];
    });
  });
}

- (void)stop
{
  std::lock_guard<std::mutex> lock(_surfaceMutex);

  if (_surfaceHandler->getStatus() != SurfaceHandler::Status::Running) {
    return;
  }

  _surfaceHandler->stop();
  [self _propagateStageChange];

  RCTExecuteOnMainQueue(^{
    [self->_surfacePresenter.mountingManager detachSurfaceFromView:self.view
                                                         surfaceId:self->_surfaceHandler->getSurfaceId()];
  });
}
`;
const fixedLifecycle = `- (void)start
{
  NSUInteger generation;
  {
    std::lock_guard<std::mutex> lock(_surfaceMutex);
    if (_surfaceHandler->getStatus() != SurfaceHandler::Status::Registered) {
      return;
    }
    generation = ++_surfaceLifecycleGeneration;
  }

  RCTExecuteOnMainQueue(^{
    std::lock_guard<std::mutex> lock(self->_surfaceMutex);
    if (generation != self->_surfaceLifecycleGeneration) {
      return;
    }
    if (!self->_surfaceViewAttached) {
      [self->_surfacePresenter.mountingManager attachSurfaceToView:self.view
                                                         surfaceId:self->_surfaceHandler->getSurfaceId()];
      self->_surfaceViewAttached = YES;
    }
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE, 0), ^{
      std::lock_guard<std::mutex> lock(self->_surfaceMutex);
      if (generation != self->_surfaceLifecycleGeneration ||
          self->_surfaceHandler->getStatus() != SurfaceHandler::Status::Registered) {
        return;
      }
      self->_surfaceHandler->start();
      // Stop must not destroy the shadow tree before the animation driver uses it.
      [self->_surfacePresenter setupAnimationDriverWithSurfaceHandler:*self->_surfaceHandler];
      [self _propagateStageChange];
    });
  });
}

- (void)stop
{
  NSUInteger generation;
  {
    std::lock_guard<std::mutex> lock(_surfaceMutex);
    // Cancel queued starts even if the surface has not reached Running yet.
    generation = ++_surfaceLifecycleGeneration;
    if (_surfaceHandler->getStatus() == SurfaceHandler::Status::Running) {
      _surfaceHandler->stop();
      [self _propagateStageChange];
    }
  }

  RCTExecuteOnMainQueue(^{
    std::lock_guard<std::mutex> lock(self->_surfaceMutex);
    // A later start owns the view now; an older stop must not detach it.
    if (generation != self->_surfaceLifecycleGeneration || !self->_surfaceViewAttached) {
      return;
    }
    self->_surfaceViewAttached = NO;
    [self->_surfacePresenter.mountingManager detachSurfaceFromView:self->_view
                                                         surfaceId:self->_surfaceHandler->getSurfaceId()];
  });
}
`;
const originalMutex = "  std::mutex _surfaceMutex;";
const fixedMutex = originalMutex + "\n  NSUInteger _surfaceLifecycleGeneration;\n  BOOL _surfaceViewAttached;";
function patchSurface(source) {
  if (source.includes(fixedLifecycle) && source.includes(fixedMutex)) return source;
  if (!source.includes(originalLifecycle) || !source.includes(originalMutex) || source.includes("_surfaceLifecycleGeneration"))
    throw new Error("React Native macOS Fabric source changed; review the Spark surface lifecycle patch before building.");
  return source.replace(originalLifecycle, fixedLifecycle).replace(originalMutex, fixedMutex);
}
function installSurfaceLifecyclePatch(root) {
  const manifest = require.resolve("react-native-macos/package.json", { paths: [root] });
  const version = JSON.parse(fs.readFileSync(manifest, "utf8")).version;
  if (version !== "0.88.0-rc.4") throw new Error(`spark's Fabric lifecycle patch requires react-native-macos@0.88.0-rc.4; found ${version}.`);
  const file = path.join(path.dirname(manifest), "React/Fabric/Surface/RCTFabricSurface.mm");
  const before = fs.readFileSync(file, "utf8"), after = patchSurface(before);
  if (before !== after) {
    // Never mutate a package-manager cache through a hardlinked installed file.
    const temporary = `${file}.spark-${process.pid}.tmp`;
    fs.writeFileSync(temporary, after);
    fs.renameSync(temporary, file);
  }
}
module.exports = { patchSurface, installSurfaceLifecyclePatch };
