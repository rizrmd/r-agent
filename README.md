browser-use-play
====

Browser-use-play is a Node.js implementation of the browser-use library, enabling AI agents to control your browser. It provides a simple way to integrate AI agents with your browser and automate tasks.

⚠️ IMPORTANT NOTE ⚠️

The code in this repository is ported from the Python library browser_use, preserve the original API functionality as much as possible. **Please do not use it in production environments**, it is intended for llm learning purposes only.
If you need stable functionality, please visit the original browser-use repository:  [browser-use](https://github.com/browser-use/browser-use).


## Usage
To use browser-use-play, you need to have Node.js installed on your system. You can then install the library using npm:
```bash
npm install browser-use-play
```
Requirements:

Node: >=16.0.0

## Examples

### Chat with your browser using GPT-4
Here are some examples of how to use browser-use-play:
```javascript
import { ChatOpenAI } from 'browser-use-play';
import { Agent } from 'browser-use-play';

// Initialize LLM
const llm = new ChatOpenAI({
  modelName: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: process.env.OPENAI_API_BASE
});

// Initialize agent
const agent = new Agent(
  'Go to hackernews show hn and give me the first  5 posts',
  llm
);
// max_steps=10
await agent.run(10);
```

### Chat with your browser using ollama
Here are some examples of how to use browser-use-play:
```javascript
import { ChatOllama } from 'browser-use-play';
import { Agent } from 'browser-use-play';

// Initialize LLM
const llm = new ChatOllama({
  modelName: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: process.env.OPENAI_API_BASE
});

// Initialize agent
const agent = new Agent(
  'Go to hackernews show hn and give me the first  5 posts',
  llm
);
// max_steps=10
await agent.run(10);
```

### Chat with your browser using ernie4.0
Here are some examples of how to use browser-use-play:
```javascript
import { ChatQianfan } from 'browser-use-play';
import { Agent } from 'browser-use-play';

// Initialize LLM
const llm = new ChatQianfan({
  modelName: 'ernie-4.0-turbo-128k',
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
    toolCallingMethod:  'raw',
  }
);
// max_steps=10
await agent.run(10);
```

## Environment Variables
To use browser-use-play, you can to set the following environment variables:
- `OPENAI_API_KEY`: Your OpenAI API key.
- `OPENAI_API_BASE`: Your OpenAI API base url.
- `QIANFAN_API_KEY`: Your Qianfan API key.
- `QIANFAN_API_BASE`: Your Qianfan API base url.
- `OLLAMA_API_BASE`: Your Ollama API base url.

copy .env.example to .env and fill in the variables.

## Related
- [browser-use](https://github.com/browser-use/browser-use)
- [playwright](https://github.com/microsoft/playwright)
