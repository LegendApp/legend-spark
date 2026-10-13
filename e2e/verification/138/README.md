# #138 Privileged helper, admin prompt and XPC: verification

I opened and checked every image. All come from driver mode, where `@legendapp/spark/privileged-helper` answers from simulated state: SMAppService, Authorization Services and launchd were never called, no admin prompt was shown, no XPC connection was made and nothing ran as root.

## Kitchen Sink screen

The approved goldens of `e2e/flows/processes-ipc/privileged-helper-visual.yaml` (`bun run e2e:run … --backend driver` against a dev build of this branch).

| Image | What it shows |
|---|---|
| privileged-helper-light.png | Availability `unsigned` (the dev build is ad-hoc signed), no status yet, Register / Unregister / Open Login Items, Request admin rights (Release disabled until rights are held), Send whoami. |
| privileged-helper-dark.png | The same screen in dark mode. |
| privileged-helper-light-ar.png | Arabic labels, right to left, with the localized title in the breadcrumb. Availability and results are API data and stay untranslated. |

## Driver flows

The flows' `takeScreenshot` outputs.

| Image | What it shows |
|---|---|
| driver-privileged-helper-availability.png | Signed simulated: available; the helper the Kitchen Sink does not embed reports notFound and Register rejects `E_NOT_FOUND:notFound`. |
| driver-privileged-helper-register.png | Register after unregistering with approval granted: `registered: enabled`. |
| driver-privileged-helper-authorization.png | After the prompt answers authorized, cancel, denied and notInteractive: the last result `PrivilegedHelperError:E_UNAVAILABLE:notInteractive`, no rights held. |
| driver-privileged-helper-xpc.png | The helper's JSON reply after the connection was refused and interrupted and then accepted again. |
