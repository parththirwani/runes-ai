"use client"
import { motion } from "framer-motion";
import { Button } from "@/src/app/components/ui/button";
import { Home, ArrowLeft, Search } from "lucide-react";
import Link from "next/link";

const NotFound = () => {
  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-background">
      {/* Background Effects */}
      <div className="absolute inset-0 grid-pattern opacity-50" />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[120px] animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-destructive/10 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />
      
      <div className="container mx-auto px-6 relative z-10">
        <div className="max-w-3xl mx-auto text-center">
          {/* 404 Number */}
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, type: "spring", bounce: 0.4 }}
            className="relative mb-8"
          >
            <h1 className="text-[12rem] md:text-[16rem] font-bold tracking-tight text-transparent bg-clip-text bg-linear-to-br from-primary via-primary/60 to-primary/20 leading-none">
              404
            </h1>
            <div className="absolute inset-0 blur-2xl opacity-30">
              <h1 className="text-[12rem] md:text-[16rem] font-bold tracking-tight text-primary leading-none">
                404
              </h1>
            </div>
          </motion.div>

          {/* Error Message */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mb-6"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Page Not Found
            </h2>
          </motion.div>

          {/* Code Block Decoration */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="mb-10 max-w-md mx-auto"
          >
            <div className="gradient-border rounded-lg overflow-hidden">
              <div className="bg-card p-4 font-mono text-sm text-left">
                <div className="text-destructive">
                  <span className="text-muted-foreground">Error:</span> 
                  <span className="ml-2">Page not found</span>
                </div>
                <div className="text-muted-foreground mt-2">
                  <span className="text-amber-500">\include</span>
                  {"{missing-page.tex}"}
                </div>
                <div className="mt-2 text-muted-foreground">
                  ! Emergency stop.
                </div>
              </div>
            </div>
          </motion.div>

          {/* Action Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.7 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link href="/">
              <Button size="lg" className="glow text-lg px-8 py-6 min-w-50">
                <Home className="mr-2 w-5 h-5" />
                Go Home
              </Button>
            </Link>
            <Button 
              size="lg" 
              variant="outline" 
              className="text-lg px-8 py-6 border-border hover:bg-secondary hover:text-slate-300 min-w-50"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="mr-2 w-5 h-5" />
              Go Back
            </Button>
          </motion.div>

          {/* Helpful Links */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.9 }}
            className="mt-16 pt-8 border-t border-border/50"
          >
            <p className="text-sm text-muted-foreground mb-4">Need help? Try these:</p>
            <div className="flex flex-wrap items-center justify-center gap-6">
              <Link href="/chat" className="text-sm text-primary hover:text-primary/80 transition-colors font-medium">
                Start Writing
              </Link>
              <Link href="/#features" className="text-sm text-primary hover:text-primary/80 transition-colors font-medium">
                Features
              </Link>
              <Link href="/#docs" className="text-sm text-primary hover:text-primary/80 transition-colors font-medium">
                Documentation
              </Link>
              <Link href="/signin" className="text-sm text-primary hover:text-primary/80 transition-colors font-medium">
                Sign In
              </Link>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default NotFound;