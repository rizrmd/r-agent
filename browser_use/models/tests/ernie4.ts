/**
 * Simple try of the agent.
 *
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import { ChatQianfan } from '../qianfan';
import { Agent } from '../..';
import { mockHackernews } from './mock/ernie4-hackernews';


describe('test chatGPT Agent Tests', () => {
  jest.setTimeout(60000);

  it('test chatGPT Agent Tests', async () => {
      // Initialize LLM
      const llm = new ChatQianfan({
        modelName: 'ernie-4.0-turbo-128k',
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
        llm,
        {
          useVision: false,
          maxFailures: 2,
          maxActionsPerStep: 1,
          toolCallingMethod:  'raw',
        }
      );
      const result = await agent.run(10); // max_steps=10
      expect(result).not.toBeNull();
  })
});