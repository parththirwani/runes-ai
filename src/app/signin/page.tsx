"use client"
import { motion } from "framer-motion";
import { Button } from "@/src/app/components/ui/button";
import { Sparkles, Chrome } from "lucide-react";
import { useTransition } from "react";
import { handleGoogleSignIn } from "../actions";

export default function SignInPage() {
  const [isPending, startTransition] = useTransition();

  const handleSubmit = () => {
    console.log("Button clicked!"); // Debug log
    startTransition(async () => {
      console.log("Starting sign in..."); // Debug log
      await handleGoogleSignIn();
    });
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background Effects - matching Hero section */}
      <div className="absolute inset-0 grid-pattern opacity-50 pointer-events-none" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-150 h-150 bg-primary/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-100 h-100 bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
      
      <div className="container mx-auto px-6 relative z-10">
        <div className="max-w-md mx-auto">
          {/* Sign In Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="gradient-border rounded-xl overflow-hidden glow relative"
            style={{ zIndex: 10 }}
          >
            <div className="bg-card p-8 md:p-10 relative z-20">
              {/* Badge */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/5 mb-6"
              >
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-sm text-muted-foreground">AI-Powered LaTeX Editor</span>
              </motion.div>

              {/* Headline */}
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="text-3xl md:text-4xl font-bold tracking-tight mb-3"
              >
                Welcome to{" "}
                <span className="text-gradient">Runes AI</span>
              </motion.h1>

              {/* Subheadline */}
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
                className="text-muted-foreground mb-8"
              >
                Sign in to start writing beautiful LaTeX papers at the speed of thought.
              </motion.p>

              {/* Sign In Button */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.4 }}
                className="relative z-30"
              >
                <Button
                  type="button"
                  size="lg"
                  onClick={handleSubmit}
                  disabled={isPending}
                  className="w-full glow text-base px-6 py-6 flex items-center justify-center gap-3 relative z-40"
                  style={{ position: 'relative', zIndex: 50 }}
                >
                  <Chrome className="w-5 h-5" />
                  {isPending ? "Signing in..." : "Sign in with Google"}
                </Button>
              </motion.div>

              {/* Features List */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.5 }}
                className="mt-8 pt-8 border-t border-border/50"
              >
                <p className="text-xs text-muted-foreground mb-4">What you'll get:</p>
                <div className="space-y-3">
                  {[
                    "AI-powered LaTeX suggestions",
                    "Real-time collaboration",
                    "Unlimited documents",
                  ].map((feature, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                      <span className="text-sm text-muted-foreground">{feature}</span>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* Footer Note */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.6 }}
                className="text-xs text-muted-foreground text-center mt-6"
              >
                By signing in, you agree to our Terms of Service and Privacy Policy
              </motion.p>
            </div>
          </motion.div>

          {/* Additional Info */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.7 }}
            className="text-center text-sm text-muted-foreground mt-6"
          >
            Trusted by researchers at MIT, Stanford, Harvard & Cambridge
          </motion.p>
        </div>
      </div>
    </section>
  );
}