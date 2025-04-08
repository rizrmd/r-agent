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
  modelName: 'ernie-4.0-turbo-128k',
  // model_name: 'deepseek-r1',
  apiKey: process.env.QIANFAN_API_KEY,
  baseUrl: process.env.QIANFAN_API_BASE,
});

// Initialize agent
const agent = new Agent(
  '打开小红书搜索北京旅游，总结第一篇文章的内容',
  llm,
  {
    useVision: false,
		maxFailures: 2,
		maxActionsPerStep: 1,
    toolCallingMethod:  'raw',
    context: {
      simplifyText: true,
    }
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