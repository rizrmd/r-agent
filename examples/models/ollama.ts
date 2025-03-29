/**
 * Simple try of the agent.
 */

import * as dotenv from 'dotenv';
import { ChatOllama } from '../../browser_use';
import { Agent } from '../../browser_use';

// Load environment variables
dotenv.config();

// Initialize LLM
const llm = new ChatOllama({
  modelName: 'qwen2.5:32b',
  baseUrl: process.env.OLLAMA_API_BASE,
  options: {
    num_ctx: 32000,
  }
});

// Initialize agent
const agent = new Agent(
  'Search for \'playwright\' package on the npm repo, open it and summarize the package info.',
  llm,
  {
    maxFailures: 2,
    maxActionsPerStep: 1,
  }
);

// Main function
async function main(): Promise<void> {
  console.debug("test browser-use");

  await agent.run(10); // max_steps=10

  // In Node.js, we can use readline for user input
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  readline.question('Press Enter to continue...', () => {
    readline.close();
    process.exit(0);
  });
}

// Execute main function
main().catch(error => {
  console.error(`Error in main: ${error}`);
  process.exit(1);
});