# #157 Accessibility audit: verification

The `auditAccessibility` flows (`e2e/flows/accessibility/`, check `A11Y-AUDIT-01`) ran with `--backend driver` against
a Kitchen Sink dev build of this branch: 84 of 84 flow runs passed. That covers 21 flows in light and dark, English and
Arabic, with 364 audits, 56,548 elements and 36,660 measured texts. Before the fixes, the same audits found 78
errors.

These captures come from the visual flows of that run. I opened and checked each one.

| Image | What it shows |
|---|---|
| sidebar-react-rows-light.png | Light, English. The selected row's detail ("5 albums") is drawn in the foreground colour; the other details are muted. |
| sidebar-react-rows-dark.png | The same in dark. The muted detail was 3.74:1 on the selection. |
| sidebar-react-rows-dark-ar.png | Dark, Arabic, right to left. |
| documents-light.png | Light, English. Muted text (the description, breadcrumb and checks) now uses `#4b5563` instead of `#6b7280`, which was 4.38:1 on the background. |
| documents-light-ar.png | The same in Arabic. |
