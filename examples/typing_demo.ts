import {
  ChatOpenAI,
  ChatGroqAI,
  ChatGeminiAI,
  HumanMessage,
  SystemMessage,
  OpenAIMessage,
  OpenAIResponse,
} from "../browser_use";

// Example showing improved type safety
async function demonstrateTypedResponses() {
  // All models now return properly typed OpenAI-compatible responses
  const openaiModel = new ChatOpenAI({
    modelName: "gpt-4",
    apiKey: process.env.OPENAI_API_KEY,
  });

  const groqModel = new ChatGroqAI({
    modelName: "llama3-8b-8192",
    apiKey: process.env.GROQ_API_KEY,
  });

  const geminiModel = new ChatGeminiAI({
    modelName: "gemini-pro",
    apiKey: process.env.GEMINI_API_KEY,
  });

  const messages = [
    new SystemMessage({ content: "You are a helpful assistant." }),
    new HumanMessage({ content: "Hello!" }),
  ];

  // All these responses are now properly typed as OpenAIMessage
  const openaiResponse: OpenAIMessage = await openaiModel.invoke(messages);
  const groqResponse: OpenAIMessage = await groqModel.invoke(messages);
  const geminiResponse: OpenAIMessage = await geminiModel.invoke(messages);

  // TypeScript now knows these properties exist and are properly typed
  console.log("OpenAI response role:", openaiResponse.role); // "assistant" | "user" | "system" | "tool"
  console.log("OpenAI response content:", openaiResponse.content); // string | Content[] | null
  console.log("Tool calls:", openaiResponse.tool_calls); // OpenAIToolCall[] | undefined

  // Same for all other models - consistent interface!
  console.log("Groq response role:", groqResponse.role);
  console.log("Gemini response content:", geminiResponse.content);

  return {
    openai: openaiResponse,
    groq: groqResponse,
    gemini: geminiResponse,
  };
}

// Example showing the benefit - no more 'any' types!
async function beforeAndAfter() {
  const model = new ChatOpenAI({
    modelName: "gpt-4",
    apiKey: process.env.OPENAI_API_KEY,
  });

  // BEFORE: result was 'any' - no type safety
  // const result: any = await model.invoke([...]);

  // AFTER: result is properly typed as OpenAIMessage
  const result: OpenAIMessage = await model.invoke([
    new HumanMessage({ content: "What's 2+2?" }),
  ]);

  // TypeScript now provides autocomplete and type checking!
  if (result.role === "assistant") {
    console.log("Assistant responded:", result.content);
  }

  // Tool calls are properly typed too
  if (result.tool_calls) {
    for (const toolCall of result.tool_calls) {
      console.log(`Tool: ${toolCall.function.name}`);
      console.log(`Args: ${toolCall.function.arguments}`);
      console.log(`ID: ${toolCall.id}`);
    }
  }
}

export { demonstrateTypedResponses, beforeAndAfter };
