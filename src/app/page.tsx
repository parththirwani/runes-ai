import CTA from "./components/landing/CTA";
import Features from "./components/landing/features";
import Footer from "./components/landing/footer";
import Hero from "./components/landing/hero";
import HowItWorks from "./components/landing/howItWorks";
import Navbar from "./components/landing/navbar";

const Home = () => {
  return (
    <main id="main" className="min-h-screen bg-background">
      <Navbar />
      <Hero />
      <Features />
      <HowItWorks />
      <CTA />
      <Footer />
    </main>
  );
};

export default Home;
