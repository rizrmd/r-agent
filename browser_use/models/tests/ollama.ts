/**
 * Simple try of the agent.
 *
 * @dev You need to add OLLAMA_API_BASE to your environment variables.
 */

import { ChatOllama } from '../ollama';
import { Agent } from '../..';
import { mockHackernews } from './mock/ollama-hackernews';


describe('test chatGPT Agent Tests', () => {
  jest.setTimeout(60000);

  it('test chatGPT Agent Tests', async () => {
      // Initialize LLM
      const llm = new ChatOllama({
        modelName: 'qwen2.5:32b',
        baseUrl: process.env.OLLAMA_API_BASE,
        options: {
          num_ctx: 32000,
        }
      });
      jest.spyOn(llm, 'request').mockImplementation(async (options: any) => {
        console.log('mock request', options.messages.length);
        return (await mockHackernews(options.messages)).message;
      });

      // Initialize agent
      const agent = new Agent(
        'Go to hackernews show hn and give me the first  5 posts',
        llm
      );
      const result = await agent.run(10); // max_steps=10
      expect(result).not.toBeNull();
      expect(result.history.pop().result[0].success).toBeTruthy();
  })
});