import { notFound } from "next/navigation";
import Page from "@/app/page";
import { PresentationProvider } from "@/components/skins/PresentationProvider";
import { deploymentTarget, resolvePresentation } from "@/lib/shell/presentation";

export const dynamic = "force-dynamic";

/** Preview/local review route. Production always resolves to the primary 909
 * presentation and this alternate route remains undiscoverable. */
export default function SkinLabPage() {
  const target = deploymentTarget(process.env.VERCEL_ENV);
  const presentation = resolvePresentation("folio", target);
  if (presentation !== "folio") notFound();
  return <PresentationProvider presentation={presentation}><Page /></PresentationProvider>;
}
