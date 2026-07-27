import { writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  buildRc54ControlPlaneBootstrap,
  renderRc54BootstrapSql,
} from "../lib/channels/rc54ControlPlaneBootstrap";

const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
if (!outputPath || !isAbsolute(outputPath) || !outputPath.endsWith(".sql")) {
  throw new Error("usage: --output /absolute/path/to/rc54-bootstrap.sql");
}

const bootstrap = buildRc54ControlPlaneBootstrap();
writeFileSync(outputPath, renderRc54BootstrapSql(bootstrap), {
  encoding: "utf8",
  flag: "wx",
});
console.log(JSON.stringify({
  state: "generated-local-only",
  outputPath,
  specs: bootstrap.specs.length,
  manifestContentHash: bootstrap.manifestContentHash,
  activationAuthorized: bootstrap.activationAuthorized,
}));
