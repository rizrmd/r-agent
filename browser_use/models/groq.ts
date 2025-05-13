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

    if (!response.ok) {
      const errorBody = await response.text();

      let result: any = errorBody;
      let input: any = body;
      let parsedFailedGeneration: any = null;

      try {
        result = JSON.parse(errorBody);
        input = JSON.parse(body);

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

      const errorLogDir = join(process.cwd(), "error_logs");
      const dirExists = existsSync(errorLogDir);
      if (!dirExists) {
        mkdirSync(errorLogDir, { recursive: true });
      }
      Bun.file(
        join(process.cwd(), "error_logs", Date.now().toString()) + ".json"
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

    if (!responseData.choices || responseData.choices.length === 0) {
      console.error("Groq API Error: No choices returned", responseData);
      throw new Error("Groq API request returned no choices.");
    }
    return responseData.choices[0].message;
  }
}
