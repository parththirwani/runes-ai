import { OpenRouter } from "@openrouter/sdk";

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const SYSTEM_PROMPT = `You are an expert LaTeX document assistant. Your role is to help users edit, improve, and work with their LaTeX documents.

Guidelines:
- Always respond with valid LaTeX code when making changes
- Preserve the document structure and formatting unless asked to change it
- When suggesting edits, provide the complete modified section
- Explain your changes briefly before providing the LaTeX code
- Be precise with LaTeX syntax and avoid introducing errors
- If you're unsure about a change, ask for clarification
- Maintain consistency with the existing document style

When responding:
1. First, provide a brief explanation of what you're doing
2. Then provide the LaTeX code in a code block
3. Keep the original document context in mind`;

export async function ChatCompletion(
  userMessage: string,
  documentContent: string,
  documentTitle: string
) {
  if (!userMessage || typeof userMessage !== "string") {
    throw new Error("User message must be a non-empty string");
  }

  const messages = [
    {
      role: "system" as const,  // Add 'as const' to make it a literal type
      content: SYSTEM_PROMPT,
    },
    {
      role: "user" as const,    // Add 'as const' to make it a literal type
      content: `I'm working on a LaTeX document titled "${documentTitle}".

Here is the current document content:

\`\`\`latex
${documentContent}
\`\`\`

My request: ${userMessage}`,
    },
  ];

  const result = openrouter.callModel({
    model: "google/gemini-2.5-flash",
    input: messages,
  });

  return result.getTextStream();
}