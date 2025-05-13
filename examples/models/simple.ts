import { Agent } from "../../browser_use";
import { ChatGroqAI } from "../../browser_use/models/groq";
import { ChatOpenRouterAI } from "../../browser_use/models/openrouter";

// Initialize LLM
const llm = new ChatOpenRouterAI({
  modelName: "meta-llama/llama-4-scout",
  // modelName: "meta-llama/llama-4-scout-17b-16e-instruct",
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Initialize agent
const agent = new Agent(
  'search for rizrmd on the web and extract the text from the first page, output in json format like this: {"page_1": "text"}',
  llm,
  {
    pageExtractionLLM: llm,
    validateOutput: true,
    registerNewStepCallback(state, modelOutput, step) {
      console.log(
        `Step ${step}, ${modelOutput}, State: ${JSON.stringify(
          modelOutput.current_state,
          null,
          2
        )}`
      );
    },
  }
);

// Main function
async function main(): Promise<void> {
  await agent.run(10); // max_steps=10
}

// Execute main function
main().catch((error) => {
  console.error(`Error in main: ${error}`);
  process.exit(1);
});
