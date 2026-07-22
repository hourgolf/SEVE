import { notFound } from "next/navigation";
import { MarketHoursFixtureLab } from "@/components/fixtures/MarketHoursFixtureLab";
import { deploymentTarget } from "@/lib/shell/presentation";
import { fixtureLaneAvailable } from "@/lib/ui/fixtureLane";
import "./fixture-lab.css";

export const dynamic = "force-dynamic";

export default function FixtureLabPage() {
  if (!fixtureLaneAvailable(deploymentTarget(process.env.VERCEL_ENV))) notFound();
  return <MarketHoursFixtureLab />;
}
