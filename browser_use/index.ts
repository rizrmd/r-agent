import { setupLogging } from "./logging_config";

setupLogging();

export { BrowserAgent } from "./agent/service";
export { Controller } from "./controller/service";
export { Browser } from "./browser/browser";
export type { BrowserConfig } from "./browser/browser";
export { BrowserContext, BrowserContextConfig } from "./browser/context";
export type { Message, OpenAIMessage, OpenAIResponse, OpenAIToolCall, OpenAIFunctionCall } from "./models/langchain";
export {
  BaseChatModel,
  BaseMessage,
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from "./models/langchain";
export { ChatOpenAI } from "./models/openai";
export { ChatGroqAI } from "./models/groq";
export { ChatGeminiAI } from "./models/gemini";
export { ChatOpenRouterAI } from "./models/openrouter";
export { ChatOllama } from "./models/ollama";
