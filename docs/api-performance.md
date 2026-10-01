# API performance follow-up

Spark adapters should call their implementations directly. The design rules are in
[API design](api-design.md#direct-adapters-and-execution-cost).

## Implemented changes

- Settings validate without cloning, return freshly parsed values, and serialize
  writes once before queued work. Observable persistence without an encoder writes
  its existing serialized snapshot. Per-key updater ordering remains necessary.
- Files, clipboard PNG data, and process IO use direct native ArrayBuffers. Mutable
  inputs are snapshotted once before submission returns; owned outputs become JS
  views. Process input uses the native FIFO, without a duplicate JS queue. Command
  resolution happens during native launch instead of a separate RPC. Streamed output
  allows 64 pending chunks per stream (1 MiB), and waits only when JS falls behind.
- Desktop events share one native subscription and route by event type and resource.
  A process output event does not invoke unrelated feature callbacks.
- Audio commands, readiness and status use backend events. Native position observation
  exists only while somebody subscribes. Get-status reads do not republish Now Playing.
  Audio command ordering remains because a seek can complete after later submissions.
- Loopback authentication delivers socket callbacks through events. Only the session
  deadline remains; there is no JS polling timer.
- Shortcut dispatch uses bindings compiled at registration and key-indexed candidates.
  It does not sort or parse accelerators on every keystroke.
- Tray patches reuse unchanged images and menus. Sidebar selection updates preserve
  native rows. Uncontrolled text input does not render merely to acknowledge typing.
  Drop payloads normalize once, and unchanged native menu publications preserve items.
  Changed composed menus still use full publication to preserve overlays and rollback.
- Shared native error translation accepts synchronous implementations directly;
  synchronous Codex controls no longer need artificial async callbacks.

## Measurements

The settings probe used a native macOS Hermes runtime, a 216,451-byte JSON payload
with 3,000 records, and in-memory storage. It excludes disk IO. Before medians use
27 samples across three fresh hosts; after medians use nine samples in another host.
These are separate runs, not paired samples.

| Operation | Before | After |
| --- | ---: | ---: |
| Settings read | 12.13 ms | 3.23 ms |
| Settings write | 11.96 ms | 4.17 ms |
| Persistence flush without encoder | 13.88 ms | 4.93 ms |

The corresponding direct persistence serialization baseline after the change was
4.74 ms. JSON parse/stringify alone are cheaper than settings operations because
settings also validate data and preserve update ordering.

The actual shared C++ buffer binding was measured in macOS Hermes with a 1 MiB
payload and 27 samples: approximately 0.017 ms for an owned output buffer to a JS
view, and 0.067 ms for an eager input snapshot. These timings include the binding's
promise and invoker path but exclude filesystem, clipboard, and process IO. They
are not end-to-end throughput comparisons with the previous base64 path.
`tests/binary-transport.native.cpp` retains this probe and correctness checks.

## Verification and limits

All 586 tests across 116 Vitest files and workspace TypeScript checks pass. Native fixtures
compile and exercise changed macOS process, audio, tray, menu, sidebar, and buffer
paths. The real loopback socket fixture verifies malformed requests, callback
arrival, and closure. Fixtures use stub React hosts where appropriate; they do not
establish full React Native application acceptance. Windows implementations are
updated but cannot be compiled or accepted on this Mac without a Windows toolchain.

## Native keyboard consumption

The macOS keyboard monitor no longer waits 10 ms for a JavaScript response. It
matches compiled, enabled native rules before publishing observation events. Command
handler fall-through is internal to Spark; it cannot change AppKit propagation.
Native capture owns temporary consumption, and paired keyups remain consumed after
owner removal. Enablement and suspension changes acknowledge native installation.

The actual native matcher and stub emitter processed 20,000 fixture events in a
median 8.145 ms across three fresh processes. This excludes React Native and JS
callback delivery, and is not an end-to-end input latency benchmark. The fixture
checks scopes, modifier normalization, repeat behavior, capture owners, atomic
updates and cleanup. Actual source compilation against generated TurboModule headers
also passes. Full interactive application keyboard acceptance remains unverified.
