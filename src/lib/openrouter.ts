// src/lib/openrouter.ts
import { OpenRouter } from "@openrouter/sdk";

const openRouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const SYSTEM_PROMPT = `You are an expert LaTeX document assistant. Your role is to help users edit, improve, and work with their LaTeX documents.

When the user requests changes, you must analyze the document and return a structured JSON response containing the specific changes to be made.

Guidelines:
- Identify the exact text that needs to be changed
- Provide the line numbers where changes occur
- Give both the old text and the new replacement text
- Be precise with LaTeX syntax
- Maintain document structure and formatting unless asked to change it
- Each change should be atomic and clear

Return your response as a JSON object with this exact structure:
{
  "explanation": "Brief explanation of what you're changing and why",
  "changes": [
    {
      "lineStart": <number>,
      "lineEnd": <number>,
      "oldText": "exact text to replace",
      "newText": "replacement text"
    }
  ]
}`;

// Define the response schema
const diffResponseSchema = {
  type: "object",
  properties: {
    explanation: {
      type: "string",
      description: "Brief explanation of the changes being made",
    },
    changes: {
      type: "array",
      description: "List of changes to apply to the document",
      items: {
        type: "object",
        properties: {
          lineStart: {
            type: "number",
            description: "Starting line number (1-indexed)",
          },
          lineEnd: {
            type: "number",
            description: "Ending line number (1-indexed, inclusive)",
          },
          oldText: {
            type: "string",
            description: "Exact text to be replaced",
          },
          newText: {
            type: "string",
            description: "New text to replace with",
          },
        },
        required: ["lineStart", "lineEnd", "oldText", "newText"],
        additionalProperties: false,
      },
    },
  },
  required: ["explanation", "changes"],
  additionalProperties: false,
} as const;

export type DiffChange = {
  lineStart: number;
  lineEnd: number;
  oldText: string;
  newText: string;
};

export type DiffResponse = {
  explanation: string;
  changes: DiffChange[];
};

export async function ChatCompletion(
  userMessage: string,
  documentContent: string,
  documentTitle: string
): Promise<DiffResponse> {
  if (!userMessage || typeof userMessage !== "string") {
    throw new Error("User message must be a non-empty string");
  }

  // Add line numbers to the document content for reference
  const numberedContent = documentContent
    .split("\n")
    .map((line, idx) => `${idx + 1}: ${line}`)
    .join("\n");

  const messages = [
    {
      role: "system" as const,
      content: SYSTEM_PROMPT,
    },
    {
      role: "user" as const,
      content: `I'm working on a LaTeX document titled "${documentTitle}".

Here is the current document content with line numbers:

\`\`\`latex
${numberedContent}
\`\`\`

My request: ${userMessage}

Please analyze the document and return the changes in the required JSON format.`,
    },
  ];

  const response = await openRouter.chat.send({
    model: "openai/gpt-4o-mini", // Use a model that supports structured output
    messages: messages,
    responseFormat: {
      type: "json_schema",
      jsonSchema: {
        name: "latex_diff",
        strict: true,
        schema: diffResponseSchema,
      },
    },
    stream: false,
  });

  const content = response.choices[0].message.content;

  if (!content) {
    throw new Error("No response from AI");
  }

  // Handle both string and array content types
  let contentString: string;
  if (typeof content === "string") {
    contentString = content;
  } else if (Array.isArray(content)) {
    // Extract text from content items
    contentString = content
      .filter((item) => item.type === "text")
      .map((item) => (item as any).text)
      .join("");
  } else {
    throw new Error("Unexpected content type from AI response");
  }

  // Parse the JSON response
  try {
    const diffResponse: DiffResponse = JSON.parse(contentString);
    return diffResponse;
  } catch (error) {
    console.error("Failed to parse AI response:", contentString);
    throw new Error("Failed to parse AI response as JSON");
  }
}