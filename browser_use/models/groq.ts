import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { ToolCallingMethod } from "../agent/views";
import {
  BaseChatModel,
  BaseMessage,
  formatToolCall,
  formatTools,
  OpenAIMessage,
  RequestParams,
  StructuredTool,
} from "./langchain";
import { cleanStringField } from "./response_parser";

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
    tools?: StructuredTool | StructuredTool[],
    tool_options?: { tool_choice?: RequestParams["tool_choice"] }
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

    // Handle both single tool and multiple tools
    let formattedTools: Partial<RequestParams> = {};
    if (tools) {
      const toolArray = Array.isArray(tools) ? tools : [tools];
      formattedTools = formatTools(toolArray, tool_options?.tool_choice);
    }

    return {
      messages,
      ...formattedTools,
    };
  }

  async request(params: RequestParams): Promise<OpenAIMessage> {
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
          result.error &&
          result.error.code === "tool_use_failed" &&
          result.error.failed_generation &&
          typeof result.error.failed_generation === "string"
        ) {
          try {
            // Attempt to remove leading non-JSON characters like '>'
            const cleanedFailureData = result.error.failed_generation.replace(
              /^[^\{]*/,
              ""
            );
            parsedFailedGeneration = JSON.parse(cleanedFailureData);
          } catch (parseError) {
            console.error(
              "Failed to parse 'failed_generation' field:",
              parseError,
              result.error.failed_generation
            );
            // Keep original failed_generation if parsing fails
            parsedFailedGeneration = result.error.failed_generation;
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

    // Clean message.content
    if (message.content) {
      if (typeof message.content === "string") {
        message.content = cleanStringField(message.content);
      } else if (Array.isArray(message.content)) {
        message.content = message.content.map(
          (block: { type: string; text?: string; [key: string]: any }) => {
            if (
              block &&
              block.type === "text" &&
              typeof block.text === "string"
            ) {
              return { ...block, text: cleanStringField(block.text) };
            }
            return block;
          }
        );
      }
    }

    // Clean message.tool_calls arguments if present
    if (message.tool_calls && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        if (
          toolCall.function &&
          toolCall.function.arguments &&
          typeof toolCall.function.arguments === "string"
        ) {
          toolCall.function.arguments = cleanStringField(
            toolCall.function.arguments
          );
        }
      }
    }

    return message;
  }
}
