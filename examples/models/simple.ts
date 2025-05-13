import { Agent } from "../../browser_use";
import { ChatGroqAI } from "../../browser_use/models/groq";
import { ChatOpenRouterAI } from "../../browser_use/models/openrouter";

// Initialize LLM
// const llm = new ChatGroqAI({
//   modelName: "meta-llama/llama-4-scout-17b-16e-instruct",
//   apiKey: process.env.GROQ_API_KEY,
// });

const llm = new ChatOpenRouterAI({
  modelName: "meta-llama/llama-4-scout",
  // modelName: "google/gemini-2.5-pro-preview", 
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Initialize agent
const agent = new Agent(
  'search for rizrmd github on the web, visit the most link, provide summary  about the page in this format { "github_name": "", "repositories": [""] }.',
  llm,
  {
    pageExtractionLLM: llm,
    // validateOutput: true,
    registerNewStepCallback(state, modelOutput, step) {
      console.log(
        `Step ${step}, State: ${JSON.stringify(
          modelOutput.current_state,
          null,
          2
        )}`
      );
    },
    registerDoneCallback(history) {
      console.log("Done! History:", history.is_successful(), history.final_result());
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
