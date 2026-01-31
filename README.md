# Runes AI

**AI-first LaTeX editor running entirely in your browser**  
Write, edit, preview, and enhance LaTeX documents with intelligent AI assistance — no installation required.

## Features (Current + Planned)

- Real-time LaTeX editing & PDF preview in browser
- AI-powered auto-completion for equations, commands & environments
- Natural language → LaTeX conversion  
  _"write the quadratic formula with explanation"_
- Smart error detection & suggestions
- Inline AI chat for rewriting, explaining or generating content
- Clean, distraction-free editor UI
- Works offline (after first load) — Progressive Web App ready
- Dark / light mode support

## Tech Stack

- **Frontend**: Next.js 14+ (App Router) + TypeScript
- **Styling**: Tailwind CSS + Shadcn/ui components
- **AI integration**: (likely OpenAI / Grok / local model via WebLLM / Transformers.js — to be specified)
- **Database/ORM**: Prisma (for user features, saved documents, etc.)
- **Runtime**: Bun (recommended) / Node.js compatible
- **Deployment**: Vercel (optimal for Next.js)

## 📂 Project Structure

```text
runes-ai/
├── prisma/               # Database schema & migrations
├── producer/             # (possibly message queue / job producer?)
├── public/               # Static assets, fonts, favicon
├── src/
│   ├── app/              # Next.js app router pages & layouts
│   ├── components/       # UI components (editor, preview, ai-panel…)
│   ├── lib/              # Utilities, AI helpers, latex parser
│   └── worker/           # Web Workers or background tasks
├── .env.example
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── bun.lock              # Using Bun package manager
