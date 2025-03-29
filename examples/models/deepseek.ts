/**
 * Simple try of the agent.
 */

import * as dotenv from 'dotenv';
import { ChatQianfan } from '../../browser_use';
import { Agent } from '../../browser_use';

// Load environment variables
dotenv.config();

// Initialize LLM
const llm = new ChatQianfan({
  modelName: 'deepseek-v3',
  // model_name: 'deepseek-r1',
  apiKey: process.env.QIANFAN_API_KEY,
  baseUrl: process.env.QIANFAN_API_BASE,
});

// Initialize agent
const agent = new Agent(
  'Go to hackernews show hn and give me the first  5 posts',
  llm,
  {
    useVision: false,
		maxFailures: 2,
		maxActionsPerStep: 1,
    toolCallingMethod: 'auto'
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