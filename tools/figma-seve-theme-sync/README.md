# SEVE 909 Theme Sync

This development plugin reads `Cream Draft`, `Blackout Draft`, and the local
`909/*` text styles from the `SEVE 909 / Foundation` collection. It produces a
validated `seve-909-theme/v1` payload and a client-only SEVE review URL.

## Install once

1. In the Figma desktop app, open **Plugins → Development → Import plugin from manifest**.
2. Select this folder's `manifest.json`.
3. Keep the plugin available under **Plugins → Development → SEVE 909 Theme Sync**.

## Iterate

1. Change Draft variables or the 909 text styles.
2. Run **SEVE 909 Theme Sync**.
3. Select **Preview in SEVE**.
4. Use the Theme Lab's Cream/Blackout switch and contrast report.

The generated URL stores tokens in the URL fragment. The payload is applied
only in the browser, never sent to the SEVE server, and does not deploy or
change production.
