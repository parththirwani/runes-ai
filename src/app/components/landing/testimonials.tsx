"use client"
import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Star } from "lucide-react";

const testimonials = [
  {
    quote: "Runes AI cut my paper writing time in half. The AI suggestions are incredibly accurate and contextually aware.",
    author: "Dr. Sarah Chen",
    role: "Professor of Physics",
    institution: "MIT",
  },
  {
    quote: "Finally, a LaTeX editor that doesn't feel like it's from the 90s. The real-time collaboration features are game-changing.",
    author: "James Rodriguez",
    role: "PhD Candidate",
    institution: "Stanford University",
  },
  {
    quote: "The citation finder alone is worth the subscription. It's found relevant papers I would have never discovered on my own.",
    author: "Dr. Emily Watson",
    role: "Research Scientist",
    institution: "DeepMind",
  },
];

const Testimonials = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="py-32 relative">
      <div className="absolute right-0 top-0 w-125 h-125 bg-primary/5 rounded-full blur-[150px]" />

      <div className="container mx-auto px-6 relative z-10">
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-2xl mx-auto mb-16"
        >
          <span className="text-primary text-sm font-semibold uppercase tracking-wider">Testimonials</span>
          <h2 className="text-4xl md:text-5xl font-bold mt-4 mb-6">
            Loved by researchers worldwide
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6">
          {testimonials.map((testimonial, index) => {
            const cardRef = useRef(null);
            const isCardInView = useInView(cardRef, { once: true, margin: "-50px" });

            return (
              <motion.div
                key={testimonial.author}
                ref={cardRef}
                initial={{ opacity: 0, y: 30 }}
                animate={isCardInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="p-6 rounded-2xl bg-card border border-border"
              >
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-primary text-primary" />
                  ))}
                </div>
                <p className="text-foreground mb-6 leading-relaxed">"{testimonial.quote}"</p>
                <div>
                  <p className="font-semibold text-foreground">{testimonial.author}</p>
                  <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                  <p className="text-sm text-primary">{testimonial.institution}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default Testimonials;
