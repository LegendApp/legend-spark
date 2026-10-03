# Changelog

## 0.0.1-next.2 — preview

This is an experimental preview of Legend Spark, a React Native and Expo SDK
for desktop applications. The package exposes 51 documented entry paths across
application APIs, UI, configuration, diagnostics, and tooling. The presence of
an export does not certify implementation or runtime support on every platform.

The release workflow now verifies release input provenance and required native
patches, stages dependency archives with the project so clones can reinstall
without the producer machine, and checks consumer dependency integrity before
package-manager lifecycle work. Runner lock recovery, package graph constraints,
update version monotonicity, and packed-consumer resolution also have regression
coverage.

This preview is not a production-readiness claim. Windows native compilation and
runtime acceptance, Intel macOS native acceptance, clean-recipient Runner install
and launch, and Developer ID signing/notarization remain separate release gates.
See [release readiness](docs/release-readiness.md) and the
[release evidence dossier](docs/release-test-dossier.md) for status and required
evidence. The preview channel remains `next`; this entry does not promote the
package to `latest`.
