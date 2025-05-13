import { ChatOpenAI } from "../../browser_use";
import { Agent } from "../../browser_use";
import { ChatGeminiAI } from "../../browser_use/models/gemini";
import { ChatGroqAI } from "../../browser_use/models/groq";

// Initialize LLM
const llm = new ChatGroqAI({
  modelName: "meta-llama/llama-4-scout-17b-16e-instruct",
  apiKey: process.env.GROQ_API_KEY,
});

// Initialize agent
const agent = new Agent(
  'open baidu search for "deepseek-v3" and summarize the results',
  llm,
  {
    pageExtractionLLM: llm,
  }
);

// Main function
async function main(): Promise<void> {
  console.debug("test browser-use");

  await agent.run(10); // max_steps=10

  // // In Node.js, we can use readline for user input
  // const readline = require("readline").createInterface({
  //   input: process.stdin,
  //   output: process.stdout,
  // });

  // readline.question("Press Enter to continue...", () => {
  //   readline.close();
  //   process.exit(0);
  // });
}

// Execute main function
main().catch((error) => {
  console.error(`Error in main: ${error}`);
  process.exit(1);
});
