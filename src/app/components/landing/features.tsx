"use client"
import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { 
  Zap, 
  Brain, 
  FileText, 
  GitBranch, 
  Search, 
  Shield 
} from "lucide-react";

const features = [
  {
    icon: Brain,
    title: "AI-Powered Writing",
    description: "Get intelligent suggestions, auto-completions, and real-time error fixes as you write. Our AI understands LaTeX syntax deeply.",
  },
  {
    icon: Zap,
    title: "Instant Compilation",
    description: "See your PDF update in real-time with sub-second compile times. No more waiting for builds.",
  },
  {
    icon: FileText,
    title: "Smart Templates",
    description: "Start with professionally designed templates for IEEE, ACM, Nature, and hundreds more journals.",
  },
  {
    icon: GitBranch,
    title: "Version Control",
    description: "Built-in Git integration with visual diff tools. Track changes and collaborate with your team seamlessly.",
  },
  {
    icon: Search,
    title: "Citation Finder",
    description: "AI-powered citation search. Find and format references from millions of papers instantly.",
  },
  {
    icon: Shield,
    title: "Private & Secure",
    description: "Your research is yours. End-to-end encryption and SOC 2 compliance keep your work safe.",
  },
];

const FeatureCard = ({ feature, index }: { feature: typeof features[0]; index: number }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="group relative p-6 rounded-2xl bg-card border border-border hover:border-primary/30 transition-all duration-300"
    >
      <div className="absolute inset-0 rounded-2xl bg-linear-to-b from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
          <feature.icon className="w-6 h-6 text-primary" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">{feature.title}</h3>
        <p className="text-muted-foreground text-sm leading-relaxed">{feature.description}</p>
      </div>
    </motion.div>
  );
};

const Features = () => {
  const headerRef = useRef(null);
  const isHeaderInView = useInView(headerRef, { once: true, margin: "-100px" });

  return (
    <section id="features" className="py-32 relative">
      <div className="absolute top-0 right-0 w-125 h-125 bg-primary/5 rounded-full blur-[150px]" />
      
      <div className="container mx-auto px-6 relative z-10">
        <motion.div
          ref={headerRef}
          initial={{ opacity: 0, y: 30 }}
          animate={isHeaderInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-2xl mx-auto mb-16"
        >
          <span className="text-primary text-sm font-semibold uppercase tracking-wider">Features</span>
          <h2 className="text-4xl md:text-5xl font-bold mt-4 mb-6">
            Everything you need to write faster
          </h2>
          <p className="text-muted-foreground text-lg">
            Runes combines the power of AI with a beautiful editing experience to help you focus on what matters—your research.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <FeatureCard key={feature.title} feature={feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;
