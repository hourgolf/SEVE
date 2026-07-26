# SEVE 909 Figma theme bridge

## Ownership

- Figma Draft modes and `909/*` text styles are the editable design source.
- `design-tokens/seve-909.json` is the approved repository snapshot.
- `app/seve-theme.generated.css` is generated output.
- Runtime Theme Lab overrides are local review state, not production state.
- The bridge applies color and font families only. Type size, spacing, radius,
  layout, and component geometry remain locked in application code.

## One-time plugin setup

Import `tools/figma-seve-theme-sync/manifest.json` as a development plugin in
Figma desktop.

## Daily iteration

1. Edit `Cream Draft`, `Blackout Draft`, or `909/*` text styles.
2. Run **SEVE 909 Theme Sync**.
3. Click **Preview in SEVE**.
4. Review Cream and Blackout in the Theme Lab.
5. Copy the review link when another reviewer needs the same draft.

The URL fragment and local storage are browser-only. They do not touch desk
data, broker controls, Vercel configuration, or production.

## Approving a draft

1. Download `seve-909-theme.json` from the plugin or Theme Lab.
2. Replace `design-tokens/seve-909.json`.
3. Run `npm run theme:generate`.
4. Run `npm run theme:selftest`, `npm run ui-control-contract-selftest`, and
   `npm run build`.
5. Commit the token snapshot and generated CSS together.
6. Review the Vercel branch preview before merge.

## Guardrails

- Both Draft modes and all required semantic colors must exist.
- Unsupported or unsafe CSS values are rejected.
- Unbundled font families are reported before application.
- Primary text must retain at least 4.5:1 contrast against panel surfaces.
- Theme Lab never enables writes or changes trading behavior.
