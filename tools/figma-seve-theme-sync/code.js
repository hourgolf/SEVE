const COLLECTION_NAME = "SEVE 909 / Foundation";
const SCHEMA = "seve-909-theme/v1";
const COLOR_NAMES = [
  "surface/chassis", "surface/panel", "surface/inset", "surface/well",
  "line/subtle", "line/strong", "text/primary", "text/muted", "text/disabled",
  "status/success", "status/attention", "status/danger", "status/info", "status/neutral",
  "focus/ring", "hardware/accent",
];

function cssColor(value) {
  if (!value || typeof value !== "object" || !("r" in value)) throw new Error("Unsupported color value");
  const channel = (n) => Math.round(Math.max(0, Math.min(1, n)) * 255);
  const r = channel(value.r);
  const g = channel(value.g);
  const b = channel(value.b);
  const alpha = typeof value.a === "number" ? value.a : 1;
  if (alpha < 0.999) return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function numberFor(variable, modeId, fallback) {
  const value = variable?.valuesByMode?.[modeId];
  return typeof value === "number" ? value : fallback;
}

function fontWeight(style) {
  const value = String(style || "").toLowerCase();
  if (value.includes("bold")) return 700;
  if (value.includes("semi")) return 600;
  if (value.includes("medium")) return 500;
  return 400;
}

async function exportTheme() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const collection = collections.find((item) => item.name === COLLECTION_NAME);
  if (!collection) throw new Error(`Missing variable collection: ${COLLECTION_NAME}`);
  const cream = collection.modes.find((mode) => mode.name === "Cream Draft");
  const blackout = collection.modes.find((mode) => mode.name === "Blackout Draft");
  if (!cream || !blackout) throw new Error("Cream Draft and Blackout Draft modes are required.");

  const allVariables = await figma.variables.getLocalVariablesAsync();
  const variables = allVariables.filter((variable) => variable.variableCollectionId === collection.id);
  const byName = new Map(variables.map((variable) => [variable.name, variable]));
  const modeTokens = (modeId) => Object.fromEntries(COLOR_NAMES.map((name) => {
    const variable = byName.get(name);
    if (!variable) throw new Error(`Missing variable: ${name}`);
    return [name, cssColor(variable.valuesByMode[modeId])];
  }));

  const styles = await figma.getLocalTextStylesAsync();
  const style = (name) => styles.find((item) => item.name === name);
  const body = style("909/Body");
  const mono = style("909/Label");
  const display = style("909/Title");
  if (!body || !mono || !display) throw new Error("Missing 909/Body, 909/Label, or 909/Title text style.");

  const typeVariable = (name, fallback) => numberFor(byName.get(name), cream.modeId, fallback);
  return {
    schema: SCHEMA,
    name: "SEVE 909 Figma Draft",
    source: {
      fileKey: figma.fileKey || undefined,
      collection: COLLECTION_NAME,
      creamMode: cream.name,
      blackoutMode: blackout.name,
      exportedAt: new Date().toISOString(),
    },
    modes: {
      cream: modeTokens(cream.modeId),
      blackout: modeTokens(blackout.modeId),
    },
    type: {
      "family/body": body.fontName.family,
      "family/mono": mono.fontName.family,
      "family/display": display.fontName.family,
      "weight/body": fontWeight(body.fontName.style),
      "weight/medium": fontWeight(style("909/Body Medium")?.fontName?.style || "Medium"),
      "weight/strong": fontWeight(display.fontName.style),
      "size/silkscreen": typeVariable("type/silkscreen", 8),
      "size/label": typeVariable("type/label", 11),
      "size/mobile-label": typeVariable("type/mobile-label", 12),
      "size/chip": typeVariable("type/chip", 12),
      "size/body": typeVariable("type/body", 14),
      "size/number": typeVariable("type/number", 16),
      "size/number-lg": typeVariable("type/number-lg", 20),
      "size/hero": typeVariable("type/hero", 24),
      "size/title": typeVariable("type/title", 32),
    },
    space: {
      "1": typeVariable("space/1", 4),
      "2": typeVariable("space/2", 8),
      "3": typeVariable("space/3", 12),
      "4": typeVariable("space/4", 16),
      "5": typeVariable("space/5", 24),
    },
    radius: {
      control: typeVariable("radius/control", 4),
      panel: typeVariable("radius/panel", 6),
      workspace: typeVariable("radius/workspace", 8),
    },
  };
}

figma.showUI(__html__, { width: 560, height: 680, themeColors: true });
exportTheme()
  .then((payload) => figma.ui.postMessage({ type: "theme", payload }))
  .catch((error) => figma.ui.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) }));

figma.ui.onmessage = (message) => {
  if (message.type === "open-preview" && typeof message.url === "string") figma.openExternal(message.url);
  if (message.type === "close") figma.closePlugin();
};
