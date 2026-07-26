import assert from "node:assert/strict";
import {
  COLOR_TOKEN_NAMES,
  DEFAULT_SEVE_THEME,
  contrastRatio,
  cssVariablesForTheme,
  validateSeveTheme,
} from "./seveTheme";

const validation = validateSeveTheme(DEFAULT_SEVE_THEME);
assert.equal(validation.valid, true, validation.errors.join("\n"));

for (const mode of ["cream", "blackout"] as const) {
  assert.equal(Object.keys(DEFAULT_SEVE_THEME.modes[mode]).length, COLOR_TOKEN_NAMES.length);
  const variables = cssVariablesForTheme(DEFAULT_SEVE_THEME, mode);
  for (const required of [
    "--909-surface-canvas", "--909-surface-panel", "--909-text-primary",
    "--bg", "--panel", "--text", "--green", "--red", "--amber", "--accent",
    "--frame-bg", "--chrome-bg", "--hw-1", "--m2-green",
    "--font-body", "--font-mono", "--sh-sans", "--sh-mono",
  ]) assert.ok(variables[required], `${mode} is missing ${required}`);
  assert.equal(variables["--fs-body"], undefined, "layout size tokens must remain application-owned");

  const primary = contrastRatio(
    DEFAULT_SEVE_THEME.modes[mode]["text/primary"],
    DEFAULT_SEVE_THEME.modes[mode]["surface/panel"],
  );
  assert.ok(primary != null && primary >= 4.5, `${mode} primary contrast is ${primary}`);
}

const broken = structuredClone(DEFAULT_SEVE_THEME);
delete (broken.modes.cream as Partial<typeof broken.modes.cream>)["text/primary"];
assert.equal(validateSeveTheme(broken).valid, false);

console.log("SEVE theme selftest: ok");
