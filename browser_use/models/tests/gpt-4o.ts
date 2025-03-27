/**
 * Simple try of the agent.
 *
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import { ChatOpenAI } from '../openai';
import { Agent } from '../..';
import { mockHackernews } from './mock/gpt-hackernews';


describe('test chatGPT Agent Tests', () => {
  jest.setTimeout(60000);

  it('test chatGPT Agent Tests', async () => {
      // Initialize LLM
      const llm = new ChatOpenAI({
        modelName: 'gpt-4o',
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: process.env.OPENAI_API_BASE
      });
      jest.spyOn(llm, 'request').mockImplementation(async (options: any) => {
        console.log('mock request', options.messages.length);
        return (await mockHackernews(options.messages)).choices[0].message;
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