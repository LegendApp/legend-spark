# #166 Hang watchdog: visual verification

Captured with `bun run ks:capture reliability-diagnostics/hang-watchdog` (in-process, no window
shown) from the development build of this branch:

- `reliability-diagnostics-hang-watchdog-light.png`: light, English
- `reliability-diagnostics-hang-watchdog-dark.png`: dark, English
- `reliability-diagnostics-hang-watchdog-light-ar.png`: light, Arabic (right to left)

The screen opens with its watchdog running at 250 ms (`watching 250`) and no reports. Reports appear
after a block; `ks:capture` cannot click, so the reported-hang state is captured by the
`hang-watchdog-report` flow (`takeScreenshot: hang-reported`).
