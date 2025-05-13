import { existsSync, mkdirSync } from "fs";
import {
  BaseChatModel,
  BaseMessage,
  formatToolCall,
  formatTools,
  RequestParams,
  StructedTool,
} from "./langchain";
import { join } from "path";

export class ChatGroqAI extends BaseChatModel {
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
    this.baseUrl = params.baseUrl || "https://api.groq.com/openai/v1";
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

    const logDir = join(process.cwd(), "logs");
    const dirExists = existsSync(logDir);
    if (!dirExists) {
      mkdirSync(logDir, { recursive: true });
    }
    let input: any = body;
    try {
      input = JSON.parse(body);
    } catch (e) {}

    if (!response.ok) {
      const errorBody = await response.text();

      let result: any = errorBody;
      let parsedFailedGeneration: any = null;

      try {
        result = JSON.parse(errorBody);

        if (
          result &&
          result.code === "tool_use_failed" &&
          result.failed_generation &&
          typeof result.failed_generation === "string"
        ) {
          try {
            // Attempt to remove leading non-JSON characters like '>'
            const cleanedFailureData = result.failed_generation.replace(
              /^[^\{]*/,
              ""
            );
            parsedFailedGeneration = JSON.parse(cleanedFailureData);
          } catch (parseError) {
            console.error(
              "Failed to parse 'failed_generation' field:",
              parseError,
              result.failed_generation
            );
            // Keep original failed_generation if parsing fails
            parsedFailedGeneration = result.failed_generation;
          }
        }
      } catch (e) {
        console.error("Failed to parse error response or input as JSON", e);
      }

      const logData: any = {
        status: response.status,
        body: input,
        response: result,
      };

      if (parsedFailedGeneration) {
        logData.parsed_failed_generation = parsedFailedGeneration;
      }

      Bun.file(
        join(process.cwd(), "logs", Date.now().toString()) + ".error.json"
      ).write(JSON.stringify(logData, null, 2));

      console.error(
        `Groq API Error: ${response.status} ${response.statusText}`,
        errorBody,
        parsedFailedGeneration
          ? `Parsed failed_generation: ${JSON.stringify(
              parsedFailedGeneration
            )}`
          : ""
      );
      throw new Error(
        `Groq API request failed with status ${response.status}: ${errorBody}`
      );
    }

    const responseData = await response.json();

    const logData: any = {
      status: response.status,
      body: input,
      response: responseData,
    };
    Bun.file(
      join(process.cwd(), "logs", Date.now().toString()) + ".log.json"
    ).write(JSON.stringify(logData, null, 2));
    if (!responseData.choices || responseData.choices.length === 0) {
      console.error("Groq API Error: No choices returned", responseData);
      throw new Error("Groq API request returned no choices.");
    }
    const message = responseData.choices[0].message;

    const cleanStringField = (inputStr: string): string => {
      let S = inputStr.trim();

      // Step 1: Remove "assistant" suffix first
      S = S.replace(/assistant\s*$/i, "").trim();

      // Step 2: Try to extract content from a Markdown code block using a general non-anchored regex.
      const markdownExtractRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
      const match = S.match(markdownExtractRegex);

      if (match && typeof match[1] === 'string') {
        S = match[1].trim();
      }

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
      return S.trim();
    };

    // Clean message.content
    if (message.content) {
      if (typeof message.content === 'string') {
        message.content = cleanStringField(message.content);
      } else if (Array.isArray(message.content)) {
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
