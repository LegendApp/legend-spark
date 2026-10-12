require("@legendapp/spark/runtime-entry");
if (!(globalThis as any).__THREADED_RUNTIME_ENV__) {
  require("./global.css");
  require("uniwind").Uniwind.setTheme("system");
  const { registerRootComponent } = require("expo");
  registerRootComponent(require("./App").default);
  // App-wide menu, shortcut and quit/close prompts live for the process, not for a window or screen.
  void require("./shell/app-controller").startAppController();
}
