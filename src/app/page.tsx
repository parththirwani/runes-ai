import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import "./landing-redesign.css";
import Navigation from "./components/landing-redesign/Navigation";
import Hero from "./components/landing-redesign/Hero";
import WorkflowProof from "./components/landing-redesign/WorkflowProof";
import FormatChoice from "./components/landing-redesign/FormatChoice";
import ControlReliability from "./components/landing-redesign/ControlReliability";
import SecondaryFeatures from "./components/landing-redesign/SecondaryFeatures";
import FinalCta from "./components/landing-redesign/FinalCta";
import { DOCUMENTS_PATH } from "@/src/lib/paths";
import { resolvePageSession } from "@/src/lib/session";

export const metadata: Metadata = {
  title: "Runes AI | Write and review documents with AI",
  description:
    "Write in Markdown or LaTeX, review AI prose suggestions before applying them, and compile your document to PDF in Runes AI.",
};

export const viewport: Viewport = { themeColor: "#FAFAF7" };

export default async function Home() {
  // Signed-in users own the product, not the pitch. The check is the same one the
  // document API applies, so this redirect can never target a session that /document
  // would then reject.
  if (await resolvePageSession()) redirect(DOCUMENTS_PATH);

  return (
    <div className="landing-redesign min-h-screen bg-canvas text-ink">
      <Navigation />
      <main id="main">
        <Hero />
        <WorkflowProof />
        <FormatChoice />
        <ControlReliability />
        <SecondaryFeatures />
        <FinalCta />
      </main>
    </div>
  );
}
