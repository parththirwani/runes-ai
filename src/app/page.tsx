import type { Metadata, Viewport } from "next";
import "./landing-redesign.css";
import Navigation from "./components/landing-redesign/Navigation";
import Hero from "./components/landing-redesign/Hero";
import WorkflowProof from "./components/landing-redesign/WorkflowProof";
import FormatChoice from "./components/landing-redesign/FormatChoice";
import ControlReliability from "./components/landing-redesign/ControlReliability";
import SecondaryFeatures from "./components/landing-redesign/SecondaryFeatures";
import FinalCta from "./components/landing-redesign/FinalCta";

export const metadata: Metadata = {
  title: "Runes AI | Write and review documents with AI",
  description:
    "Write in Markdown or LaTeX, review AI prose suggestions before applying them, and compile your document to PDF in Runes AI.",
};

export const viewport: Viewport = { themeColor: "#FAFAF7" };

export default function Home() {
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
