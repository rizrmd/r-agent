import {
  BaseChatModel,
  BaseMessage,
  formatToolCall,
  formatTools,
  RequestParams,
  StructedTool,
} from "./langchain";
import { cleanStringField, parseJsonFromResponseText } from "./response_parser";

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

    const responseText = await response.text();
    const responseData = parseJsonFromResponseText(responseText);

    if (!responseData.choices || responseData.choices.length === 0) {
      console.error("OpenRouter API Error: No choices returned", responseData);
      throw new Error("OpenRouter API request returned no choices.");
    }

    const message = responseData.choices[0].message;

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
