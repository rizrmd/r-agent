import {
  BaseChatModel,
  BaseMessage,
  formatToolCall,
  formatTools,
  RequestParams,
  StructedTool,
} from "./langchain";

export class ChatOpenRouterAI extends BaseChatModel {
  timeout?: number;
  temperature?: number;
  apiKey?: string;
  baseUrl?: string;

  constructor(params: {
    modelName: string;
    timeout?: number;
    temperature?: number;
    apiKey?: string;
    baseUrl?: string;
  }) {
    super(params.modelName);
    this.timeout = params.timeout || 60000;
    this.temperature = params.temperature || 0.7;
    this.apiKey = params.apiKey;
    this.baseUrl = params.baseUrl || "https://openrouter.ai/api/v1";
  }

  formatMessages(
    rawMessages: BaseMessage[],
    tool: StructedTool
  ): RequestParams {
    const messages: any[] = [];
    for (const m of rawMessages) {
      const newMsg: Record<string, any> = {
        role: "user",
        content: m.content,
      };
      if (m.type === "human") {
        newMsg.role = "user";
      } else if (m.type === "ai") {
        newMsg.role = "assistant";
        if (m.additional_kwargs) {
          newMsg.tool_calls = formatToolCall(m.additional_kwargs);
        }
      } else if (m.type === "tool") {
        newMsg.role = "tool";
        newMsg.tool_call_id = m.tool_call_id;
      } else if (m.type === "system") {
        newMsg.role = "system";
      }
      messages.push(newMsg);
    }
    return { messages, ...(tool ? formatTools([tool]) : {}) };
  }

  async request(params: RequestParams) {
    const url = `${this.baseUrl}/chat/completions`;
    const auth = `Bearer ${this.apiKey}`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: auth,
    };
    const body = JSON.stringify({
      ...params,
      model: this.model_name,
    });
    const response = await fetch(url, {
      method: "post",
      headers,
      body,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `OpenRouter API Error: ${response.status} ${response.statusText}`,
        errorBody
      );
      throw new Error(
        `OpenRouter API request failed with status ${response.status}: ${errorBody}`
      );
    }

    let responseText = await response.text();
    let textToParse = responseText.trim();

    // Step 1: Remove "assistant" suffix from the trimmed response
    textToParse = textToParse.replace(/assistant\s*$/i, "").trim();

    // Step 2: Try to extract content from a Markdown code block if present from the suffix-cleaned string
    const markdownBlockRegex = /```(?:json)?\s*([\s\S]+?)\s*```/; // Non-greedy, one or more characters inside
    const markdownMatch = textToParse.match(markdownBlockRegex);

    if (markdownMatch && markdownMatch[1]) {
      // If a markdown block is found, use its content
      textToParse = markdownMatch[1].trim();
    }
    // If no markdown block is found, textToParse remains the suffix-cleaned response.

    let responseData;
    try {
      responseData = JSON.parse(textToParse);
    } catch (error) {
      console.error("Failed to parse JSON response from OpenRouter:", error);
      console.error("Original response text:", responseText); 
      console.error("Text attempted for parsing:", textToParse); // Log the string that was actually parsed
      throw new Error("Failed to parse JSON response from OpenRouter.");
    }

    if (!responseData.choices || responseData.choices.length === 0) {
      console.error("OpenRouter API Error: No choices returned", responseData);
      throw new Error("OpenRouter API request returned no choices.");
    }

    const message = responseData.choices[0].message;

    const cleanStringField = (inputStr: string): string => {
      let S = inputStr.trim();

      // Step 1: Remove "assistant" suffix first
      S = S.replace(/assistant\s*$/i, "").trim();

      // Step 2: Try to extract content from a Markdown code block using a general non-anchored regex.
      // This regex looks for ```json ... ``` or ``` ... ``` (no language specified).
      // It allows for empty content within the block.
      const markdownExtractRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
      const match = S.match(markdownExtractRegex);

      if (match && typeof match[1] === 'string') {
        // If a markdown block is found, use its captured content (group 1).
        // This applies even if the block is embedded, as match() finds the first occurrence.
        S = match[1].trim();
      }
      // If no markdown block is found, S remains the suffix-cleaned string
      // (e.g., it's already plain JSON or some other text).

      // Step 3: Apply balanced brace extraction to the (potentially unwrapped) string.
      if (S.startsWith('{') || S.startsWith('[')) {
        let balance = 0;
        let inString = false;
        let escapeChar = false;
        let fieldEndIndex = -1;
        for (let i = 0; i < S.length; i++) {
          const char = S[i];
          if (escapeChar) { escapeChar = false; continue; }
          if (char === '\\') { escapeChar = true; continue; }
          if (char === '"') { if (!escapeChar) inString = !inString; }
          if (inString) continue;
          if (char === '{' || char === '[') balance++;
          else if (char === '}' || char === ']') {
            balance--;
            if (balance === 0) { fieldEndIndex = i; break; }
          }
        }
        if (fieldEndIndex !== -1) {
          S = S.substring(0, fieldEndIndex + 1);
        }
      }
      // Suffix was removed at the beginning.
      return S.trim();
    };

    // Clean message.content
    if (message.content) {
      if (typeof message.content === 'string') {
        message.content = cleanStringField(message.content);
      } else if (Array.isArray(message.content)) {
        // Handle array of content blocks (e.g., [{type: "text", text: "..."}, ...])
        message.content = message.content.map((block: { type: string; text?: string; [key: string]: any; }) => {
          if (block && block.type === 'text' && typeof block.text === 'string') {
            return { ...block, text: cleanStringField(block.text) };
          }
          return block;
        });
      }
    }

    // Clean message.tool_calls arguments if present
    if (message.tool_calls && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.function && toolCall.function.arguments && typeof toolCall.function.arguments === 'string') {
          toolCall.function.arguments = cleanStringField(toolCall.function.arguments);
        }
      }
    }

    return message;
  }
}
