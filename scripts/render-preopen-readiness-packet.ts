import { renderPreopenReadinessPacket } from "@/lib/ops/preopenReadinessPacket";
import { sealedRc54OperationalContract } from "@/lib/ops/rc54ReadinessAdapter";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

process.stdout.write(renderPreopenReadinessPacket({
  sessionDate: arg("session", "2026-07-28"),
  envFile: arg("env-file", "/Users/mattlynch/seve-dashboard/.env.local"),
  contract: sealedRc54OperationalContract(),
}));
