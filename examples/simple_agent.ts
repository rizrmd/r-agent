import { ChatGroqAI } from "../browser_use";
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "../browser_use/models/langchain";

// Initialize LLM
const llm = new ChatGroqAI({
  modelName: "meta-llama/llama-4-scout-17b-16e-instruct",
  apiKey: process.env.GROQ_API_KEY,
});

// Simple agent function that takes a task and returns a result
// Simple agent without tool calling
async function simpleAgent(task: string): Promise<unknown> {
  // Create the system prompt
  const systemPrompt =
    "You are a helpful AI assistant that can accomplish tasks in one step.";

  // Create the task prompt
  const taskPrompt = `Please complete this task: ${task}
  Return your response as a JSON object with this format:
  {
    "response": "your response here",
    "success": true/false
  }`;

  // Create messages array with proper message types
  const messages: BaseMessage[] = [
    new SystemMessage({ content: systemPrompt }),
    new HumanMessage({ content: taskPrompt }),
  ];

  // Get response from LLM
  try {
    const response = await llm.invoke(messages);
    if (typeof response.content === "string") {
      const result = JSON.parse(response.content);
      return result;
    } else {
      throw new Error("Unexpected response format");
    }
  } catch (error) {
    return {
      response:
        error instanceof Error ? error.message : "Failed to parse LLM response",
      success: false,
    };
  }
}

// Main function
async function main(): Promise<void> {
  const task = "15 + 27";

  try {
    console.log("Running simple agent...");
    const simpleResult = await simpleAgent(task);
    console.log("Simple Agent Result:", JSON.stringify(simpleResult, null, 2));
  } catch (error) {
    console.error(`Error in main: ${error}`);
    process.exit(1);
  }
}

// Execute main function
if (require.main === module) {
  main().catch((error) => {
    console.error(`Error in main: ${error}`);
    process.exit(1);
  });
}
