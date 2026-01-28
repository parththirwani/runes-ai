"use client"
import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Sparkles, PenTool, BookOpen, Upload } from "lucide-react";

const steps = [
  {
    number: "01",
    title: "Start with AI",
    description: "Describe your paper's topic and let our AI generate a structured outline with proper LaTeX formatting.",
    icon: Sparkles,
  },
  {
    number: "02",
    title: "Write & Refine",
    description: "Our intelligent editor suggests completions, fixes errors, and helps you maintain consistent style.",
    icon: PenTool,
  },
  {
    number: "03",
    title: "Cite & Reference",
    description: "Find relevant papers with AI-powered search. Citations are automatically formatted for your target journal.",
    icon: BookOpen,
  },
  {
    number: "04",
    title: "Export & Publish",
    description: "One-click export to PDF, Word, or submit directly to arXiv and major publishers.",
    icon: Upload,
  },
];

const HowItWorks = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section id="how-it-works" className="py-32 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-linear-to-b from-background via-card/30 to-background" />
      
      {/* Ambient glow */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-200 h-100 bg-primary/5 rounded-full blur-[120px]" />

      <div className="container mx-auto px-6 relative z-10">
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-2xl mx-auto mb-20"
        >
          <span className="inline-flex items-center gap-2 text-primary text-sm font-semibold uppercase tracking-wider px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6">
            <Sparkles className="w-4 h-4" />
            How it Works
          </span>
          <h2 className="text-4xl md:text-5xl font-bold mt-4 mb-6">
            From idea to <span className="text-gradient">published paper</span>
          </h2>
          <p className="text-muted-foreground text-lg">
            Our streamlined workflow helps you go from initial concept to polished publication in record time.
          </p>
        </motion.div>

        {/* Timeline container */}
        <div className="relative max-w-5xl mx-auto">
          {/* Central timeline line - desktop only */}
          <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-px bg-linear-to-b from-transparent via-primary/30 to-transparent" />

          <div className="space-y-12 lg:space-y-0">
            {steps.map((step, index) => {
              const stepRef = useRef(null);
              const isStepInView = useInView(stepRef, { once: true, margin: "-50px" });
              const isEven = index % 2 === 0;
              const Icon = step.icon;

              return (
                <motion.div
                  key={step.number}
                  ref={stepRef}
                  initial={{ opacity: 0, x: isEven ? -50 : 50 }}
                  animate={isStepInView ? { opacity: 1, x: 0 } : { opacity: 0, x: isEven ? -50 : 50 }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                  className={`relative lg:grid lg:grid-cols-2 lg:gap-8 ${index !== steps.length - 1 ? 'lg:mb-16' : ''}`}
                >
                  {/* Timeline dot - desktop */}
                  <div className="hidden lg:flex absolute left-1/2 top-8 -translate-x-1/2 z-10">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={isStepInView ? { scale: 1 } : { scale: 0 }}
                      transition={{ duration: 0.3, delay: index * 0.1 + 0.2 }}
                      className="w-12 h-12 rounded-full bg-card border-2 border-primary flex items-center justify-center glow-sm"
                    >
                      <Icon className="w-5 h-5 text-primary" />
                    </motion.div>
                  </div>

                  {/* Content - alternating sides */}
                  <div className={`${isEven ? 'lg:pr-16 lg:text-right' : 'lg:col-start-2 lg:pl-16'}`}>
                    <div className={`group relative p-6 rounded-2xl bg-card/50 border border-border/50 hover:border-primary/30 transition-all duration-300 hover:bg-card/80 ${isEven ? '' : ''}`}>
                      {/* Gradient overlay on hover */}
                      <div className="absolute inset-0 rounded-2xl bg-linear-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                      
                      <div className="relative z-10">
                        {/* Mobile icon */}
                        <div className="lg:hidden flex items-center gap-4 mb-4">
                          <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
                            <Icon className="w-5 h-5 text-primary" />
                          </div>
                          <span className="text-5xl font-bold text-primary/20">{step.number}</span>
                        </div>

                        {/* Desktop number */}
                        <div className={`hidden lg:block mb-4 ${isEven ? 'text-right' : 'text-left'}`}>
                          <span className="text-6xl font-bold text-primary/15">{step.number}</span>
                        </div>

                        <h3 className={`text-xl font-semibold text-foreground mb-3 group-hover:text-primary transition-colors ${isEven ? 'lg:text-right' : 'lg:text-left'}`}>
                          {step.title}
                        </h3>
                        <p className={`text-muted-foreground text-sm leading-relaxed ${isEven ? 'lg:text-right' : 'lg:text-left'}`}>
                          {step.description}
                        </p>
                      </div>

                      {/* Corner accent */}
                      <div className={`absolute ${isEven ? 'right-0 top-0' : 'left-0 top-0'} w-20 h-20 bg-linear-to-br from-primary/10 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${isEven ? 'rounded-tr-2xl' : 'rounded-tl-2xl'}`} />
                    </div>
                  </div>

                  {/* Empty column for alternating layout */}
                  {isEven ? <div className="hidden lg:block" /> : null}
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Bottom CTA hint */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="text-center mt-16"
        >
          <p className="text-muted-foreground text-sm">
            Ready to transform your writing workflow?{" "}
            <a href="#pricing" className="text-primary hover:underline font-medium">
              Get started today →
            </a>
          </p>
        </motion.div>
      </div>
    </section>
  );
};

export default HowItWorks;
