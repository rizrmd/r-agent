import { BrowserAgent } from "../../browser_use";
import { ChatGroqAI } from "../../browser_use/models/groq";
import { SerializableAgentState } from "../../browser_use/agent/serializable_views";
import { AgentState, AgentOutputSchema } from "../../browser_use/agent/views"; // Added AgentOutputSchema
import * as fs from 'fs';

// Initialize LLM
const llm = new ChatGroqAI({
  modelName: "meta-llama/llama-4-scout-17b-16e-instruct",
  apiKey: process.env.GROQ_API_KEY,
});

// Function to save agent state
function saveAgentState(agent: BrowserAgent, filePath: string): void {
  // Access the internal state and call its toSerializable method
  const serializableState: SerializableAgentState = (agent as any).state.toSerializable();
  fs.writeFileSync(filePath, JSON.stringify(serializableState, null, 2));
  console.log(`Agent state saved to ${filePath}`);
}

// Function to load agent state
function loadAgentState(filePath: string): AgentState | undefined {
  if (fs.existsSync(filePath)) {
    const rawData = fs.readFileSync(filePath, 'utf-8');
    const serializableState: SerializableAgentState = JSON.parse(rawData);
    // Use the static fromSerializable method on AgentState
    // We need to pass the AgentOutputSchema (or the specific output model used by the agent)
    // for proper reconstruction of history items.
    const agentState = AgentState.fromSerializable(serializableState, AgentOutputSchema);
    console.log(`Agent state loaded from ${filePath}`);
    return agentState;
  }
  console.log(`No saved state found at ${filePath}`);
  return undefined;
}

// Main function
async function main(): Promise<void> {
  const stateFilePath = "./agent_state.json";
  let loadedState = loadAgentState(stateFilePath);

  // Initialize agent
  const agent = new BrowserAgent(
    'search for rizrmd github on the web, visit the most link, provide summary about the page in this format { "github_name": "", "repositories": [""] }.',
    llm,
    {
      pageExtractionLLM: llm,
      injectedAgentState: loadedState, // Inject loaded state if available
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
        // Save state when done
        saveAgentState(agent, stateFilePath);
      },
    }
  );

  // Run the agent
  try {
    await agent.run(5); // Run for a few steps to demonstrate saving
  } catch (error) {
    console.error(`Error during agent run: ${error}`);
  } finally {
    // Ensure state is saved even if an error occurs during the run (optional)
    // saveAgentState(agent, stateFilePath);
  }

  // --- Example of loading and continuing (conceptual) ---
  // To truly continue, you'd need to ensure the BrowserContext and other
  // non-serializable parts are also appropriately managed or re-initialized.
  // This example primarily focuses on the state object itself.

  console.log("\n--- Simulating a new run with loaded state ---");
  const loadedStateForContinuation = loadAgentState(stateFilePath);
  if (loadedStateForContinuation) {
    const continuingAgent = new BrowserAgent(
      'search for another repository by rizrmd on github and summarize it.', // Potentially a new or modified task
      llm,
      {
        pageExtractionLLM: llm,
        injectedAgentState: loadedStateForContinuation,
        registerNewStepCallback(state, modelOutput, step) {
          console.log(
            `Continuing Step ${step}, State: ${JSON.stringify(
              modelOutput.current_state,
              null,
              2
            )}`
          );
        },
        registerDoneCallback(history) {
          console.log("Continuing Done! History:", history.is_successful(), history.final_result());
          saveAgentState(continuingAgent, stateFilePath); // Save updated state
        },
      }
    );
    // Note: The browser state (current page, etc.) is not part of SerializableAgentState.
    // For a true continuation, the browser would need to be navigated to the appropriate
    // state or the task would need to be robust to starting from the initial browser state.
    // await continuingAgent.run(5); // Run for a few more steps
    console.log("Conceptual continuation: Agent initialized with loaded state.");
    console.log("To fully continue, browser state and other non-serializable parts need careful handling.");
  }
}

// Execute main function
main().catch((error) => {
  console.error(`Error in main: ${error}`);
  process.exit(1);
});
