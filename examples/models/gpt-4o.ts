/**
 * Simple try of the agent.
 *
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import * as dotenv from 'dotenv';
import { ChatOpenAI } from '../../browser_use';
import { Agent } from '../../browser_use';

// Load environment variables
dotenv.config();

// Initialize LLM
const llm = new ChatOpenAI({
  modelName: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: process.env.OPENAI_API_BASE
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