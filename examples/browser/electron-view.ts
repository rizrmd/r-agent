/**
 * Simple demonstration of the CDP feature.
 *
 * To test this locally, follow these steps:
 * 1. Create a shortcut for the executable Chrome file.
 * 2. Add the following argument to the shortcut:
 *    - On Windows: `--remote-debugging-port=9222`
 * 3. Open a web browser and navigate to `http://localhost:9222/json/version` to verify that the Remote Debugging Protocol (CDP) is running.
 * 4. Launch this example.
 *
 * @dev You need to set the `GEMINI_API_KEY` environment variable before proceeding.
 */

import * as dotenv from 'dotenv';
import { ChatOllama } from '../../browser_use';

import { Agent, Controller } from '../../browser_use';
import { Browser } from '../../browser_use/browser/browser';
import { Page } from 'playwright';

// Load environment variables
dotenv.config();

let webContentsPages: Page[] = [];
const browser = new Browser({
  headless: false,
  cdp_url: 'http://localhost:9222',
  mode: 'electron-view',
  electronWebviewContext: {
    async init(session) {
      const pages = session.context.pages();
      webContentsPages = pages.filter(page => page.url().includes('about:blank'));
      webContentsPages.forEach(page => {
        page.close = async () => {
          this.goto('about:blank');
        };
        page.bringToFront = async () => {
          // do nothing
        };
      });
    },
    async pages(session) {
      return webContentsPages;
    },
    async newPage(session, url?: string) {
      return webContentsPages.find(page => page.url().includes('about:blank'));
    },
  }
});

const controller = new Controller();

async function main() {
  let task = 'Search for \'playwright\' package on the npm repo, open it and summarize the package info.';

  const llm = new ChatOllama({
    modelName: 'qwen2.5:32b',
    baseUrl: process.env.OLLAMA_API_BASE,
    options: {
      num_ctx: 32000,
    }
  });

  const agent = new Agent(
    task,
    llm,
    {
      controller,
      browser,
      initialActions: [],
    });

  await agent.run();

  console.log('Press Enter to close...');
  process.stdin.once('data', () => {
    process.exit(0);
  });
}

// Run the main function
main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});