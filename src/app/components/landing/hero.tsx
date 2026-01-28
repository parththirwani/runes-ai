"use client"
import { motion } from "framer-motion";
import { Button } from "@/src/app/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const Hero = () => {
  const universities = [
    { name: "MIT", logo: "/mit.svg" },
    { name: "Stanford", logo: "/stanford.svg" },
    { name: "Harvard", logo: "/harvard.svg" },
    { name: "Cambridge", logo: "/cambridge.svg" },
  ];

  return (
    <section className="relative min-h-screen flex items-center justify-center pt-16 overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 grid-pattern opacity-50" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-150 h-150 bg-primary/20 rounded-full blur-[120px]" />
      <div className="absolute bottom-0 left-0 w-100 h-100 bg-primary/10 rounded-full blur-[100px]" />
      
      <div className="container mx-auto px-6 relative z-10">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/5 mb-8"
          >
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm text-muted-foreground">Now with GPT-4o integration</span>
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-5xl md:text-7xl font-bold tracking-tight mb-6"
          >
            Write LaTeX at the{" "}
            <span className="text-gradient">speed of thought</span>
          </motion.h1>

          {/* Subheadline */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10"
          >
            Runes AI is the AI-first LaTeX editor that helps researchers, academics, and students 
            write beautiful papers faster than ever before.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link href="/document">
              <Button size="lg" className="glow text-lg px-8 py-6">
                Start Writing Free
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
            <Button size="lg" variant="outline" className="text-lg px-8 py-6 border-border hover:bg-secondary">
              View Demo
            </Button>
          </motion.div>

          {/* Social Proof */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="mt-16 pt-8 border-t border-border/50"
          >
            <p className="text-sm text-muted-foreground mb-6">Trusted by researchers at</p>
            <div className="flex flex-wrap items-center justify-center gap-10 md:gap-16">
              {universities.map((uni) => (
                <div key={uni.name} className="relative h-12 w-32 md:h-16 md:w-40">
                  <Image
                    src={uni.logo}
                    alt={`${uni.name} logo`}
                    fill
                    className="object-contain"
                  />
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Editor Preview */}
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="mt-20 max-w-5xl mx-auto"
        >
          <div className="gradient-border rounded-xl overflow-hidden glow">
            <div className="bg-card p-1">
              {/* Editor Header */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-destructive/60" />
                  <div className="w-3 h-3 rounded-full bg-amber-500/60" />
                  <div className="w-3 h-3 rounded-full bg-primary/60" />
                </div>
                <span className="text-sm text-muted-foreground ml-4">thesis.tex</span>
              </div>
              {/* Editor Content */}
              <div className="p-6 font-mono text-sm">
                <div className="text-muted-foreground">
                  <span className="text-primary">\documentclass</span>
                  {"{article}"}
                </div>
                <div className="text-muted-foreground mt-2">
                  <span className="text-primary">\begin</span>
                  {"{document}"}
                </div>
                <div className="mt-4 pl-4">
                  <span className="text-foreground">The quantum entanglement phenomenon...</span>
                  <span className="inline-block w-2 h-5 bg-primary animate-pulse ml-1" />
                </div>
                <div className="mt-4 p-3 rounded-lg bg-primary/10 border border-primary/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-xs text-primary font-medium">AI Suggestion</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    "Consider adding a citation to Einstein's 1935 paper on EPR paradox here..."
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default Hero;