// Lifecycle excerpt from react-native-macos RCTFabricSurface.mm (unchanged from 0.81.7 through 0.88.0-rc.4).
// Copyright (c) Meta Platforms, Inc. and affiliates. MIT licensed.
  std::mutex _surfaceMutex;

- (void)start
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
