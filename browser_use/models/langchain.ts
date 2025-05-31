import z from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

type ToolCallingMethod =
  | "auto"
  | "function_calling"
  | "json_mode"
  | "raw"
  | null
  | undefined;

// OpenAI-compatible API response interfaces
export interface OpenAIFunctionCall {
  name: string;
  arguments: string;
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: OpenAIFunctionCall;
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Content[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  // For backward compatibility with existing code
  additional_kwargs?: {
    tool_calls?: Array<{
      name: string;
      args: any;
      id?: string;
      type?: string;
    }>;
  };
}

export interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason?: string;
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
}

export interface Content {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
  };
}

export interface Message {
  // Ensure Message is exported
  role?: string;
  type?: string;
  content: string | Content[];
  tool_call_id?: string;
  tool_calls?: any[];
  additional_kwargs?: {
    tool_calls?: Array<{
      name: string;
      args: any;
      id?: string;
      type?: string;
    }>;
  };
}

export class StructuredTool {
  name?: string;
  description?: string;
  schema: z.ZodType<any>;

  constructor(data: {
    name?: string;
    description?: string;
    schema: z.ZodType<any>;
  }) {
    // Added constructor
    this.name = data.name;
    this.description = data.description;
    this.schema = data.schema;
  }
}

export class BaseMessage implements Message {
  type: string = "";
  role?: string;
  content: string | Content[];
  tool_call_id?: string;
  additional_kwargs?: Message["additional_kwargs"];

  constructor(data: Message) {
    this.content = data.content; // Initialize content
    Object.assign(this, data);
  }

  static fromJSON(data: Message): BaseMessage {
    return new BaseMessage(data);
  }

  toJSON(): Message {
    return {
      role: this.role,
      type: this.type,
      content: this.content,
      tool_call_id: this.tool_call_id,
      additional_kwargs: this.additional_kwargs,
    };
  }
}

export class HumanMessage extends BaseMessage {
  type: string = "human";
  static fromJSON(data: Message): HumanMessage {
    return new HumanMessage(data);
  }
}
export class AIMessage extends BaseMessage {
  type: string = "ai";
  static fromJSON(data: Message): AIMessage {
    return new AIMessage(data);
  }
}
export class SystemMessage extends BaseMessage {
  type: string = "system";
  static fromJSON(data: Message): SystemMessage {
    return new SystemMessage(data);
  }
}
export class ToolMessage extends BaseMessage {
  type: string = "tool";
  static fromJSON(data: Message): ToolMessage {
    return new ToolMessage(data);
  }
}

export interface RequestParams {
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description?: string;
      parameters: Record<string, any>;
    };
  }>;
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | {
        type: "function";
        function: {
          name: string;
        };
      };
  model?: string;
  messages: any[];
  provider?: {
    sort?: "throughput" | "latency" | "cost";
    ignore?: string[];
  };
}

export function formatToolCall(
  additional: Message["additional_kwargs"]
): OpenAIToolCall[] | undefined {
  if (!additional?.tool_calls) {
    return undefined;
  }
  const formatted_tool_calls: OpenAIToolCall[] = [];
  for (const tool_call_item of additional.tool_calls) {
    let args_string: string;

    if (typeof tool_call_item.args === "string") {
      // Attempt to sanitize if it's already a string and potentially malformed
      args_string = tool_call_item.args.replace(/}\/function"?$/, "}");
      try {
        // Validate if it's valid JSON after sanitization, otherwise stringify it as a fallback
        JSON.parse(args_string);
      } catch (e) {
        // If parsing fails, it means the string is not valid JSON,
        // so we stringify it to ensure it's a valid JSON string representation.
        // This handles cases where args might be a malformed string but not intended as JSON.
        args_string = JSON.stringify(tool_call_item.args);
      }
    } else {
      // If args is an object/array, stringify it
      args_string = JSON.stringify(tool_call_item.args);
    }

    formatted_tool_calls.push({
      id:
        tool_call_item.id ||
        `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // Ensure id is present
      type: "function",
      function: {
        name: tool_call_item.name,
        arguments: args_string,
      },
    });
  }
  return formatted_tool_calls;
}

type StructuredToolInput = {
  success: boolean;
  error?: Error | z.ZodError<any>;
  raw: OpenAIMessage;
  data?: z.infer<StructuredTool["schema"]>;
};

type MultipleStructuredToolInput = {
  success: boolean;
  error?: Error | z.ZodError<any>;
  raw: OpenAIMessage;
  data?: any[];
  toolCalls?: Array<{
    toolName: string;
    data: any;
    success: boolean;
    error?: Error | z.ZodError<any>;
  }>;
};

export function formatTools(rawTools: StructuredTool[]): {
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description?: string;
      parameters: Record<string, any>;
    };
  }>;
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | {
        type: "function";
        function: {
          name: string;
        };
      };
} {
  if (!rawTools?.length) {
    return {};
  }
  const tools: Array<{
    type: "function";
    function: {
      name: string;
      description?: string;
      parameters: Record<string, any>;
    };
  }> = [];
  for (const tool of rawTools) {
    if (!tool.name) continue; // Skip tools without names
    const jsonschema = zodToJsonSchema(tool.schema);
    tools.push({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: jsonschema,
      },
    });
  }
  const tool_choice =
    rawTools[0]?.name && typeof rawTools[0].name === "string"
      ? ({
          // Added check for rawTools[0].name
          type: "function" as const,
          function: {
            name: rawTools[0].name,
          },
        } as const)
      : undefined;
  return { tools, tool_choice };
}

export class BaseChatModel {
  model_name: string;
  outputSchema?: z.ZodType<any>;
  constructor(model_name: string) {
    this.model_name = model_name;
  }

  request(params: RequestParams): Promise<OpenAIMessage> {
    throw new Error("Not implemented");
  }

  formatMessages(
    messages: BaseMessage[],
    tools?: StructuredTool | StructuredTool[]
  ): RequestParams {
    return { messages };
  }

  async invoke<T = OpenAIMessage>(rawMessages: BaseMessage[]): Promise<T> {
    const result = await this.request(this.formatMessages(rawMessages));
    return result as T;
  }

  withTools(
    tools: StructuredTool[],
    options: { includeRaw?: boolean; method?: ToolCallingMethod } = {}
  ) {
    const self = this;
    const toolArray = Array.isArray(tools) ? tools : [tools];
    const isMultipleTools = Array.isArray(tools);

    return {
      async invoke<T extends MultipleStructuredToolInput>(
        rawMessages: BaseMessage[]
      ): Promise<T> {
        const message = await self.request(
          self.formatMessages(rawMessages, tools)
        );

        // Check for tool calls, potentially nested in additional_kwargs
        let actualToolCalls: any = message.tool_calls;
        if (!actualToolCalls && message.additional_kwargs?.tool_calls) {
          actualToolCalls = message.additional_kwargs.tool_calls;
        }

        if (actualToolCalls || options?.method === "function_calling") {
          if (isMultipleTools) {
            return self.handleMultipleToolCalls(
              actualToolCalls,
              toolArray,
              message,
              options
            ) as T;
          } else {
            return self.handleSingleToolCall(
              actualToolCalls?.[0],
              toolArray[0]!,
              message,
              options
            ) as T;
          }
        }

        // Handle JSON mode or string content parsing
        if (typeof message.content === "string") {
          if (isMultipleTools) {
            // For multiple tools, try to parse as array or single object
            try {
              const parsedContent = JSON.parse(message.content);
              return self.validateMultipleToolsContent(
                parsedContent,
                toolArray,
                message
              ) as T;
            } catch (e: any) {
              console.error(
                "JSON.parse failed for message content. Error:",
                e.message
              );
              console.error(
                "Content string that failed parsing:",
                message.content
              );
              return { success: false, error: e, raw: message } as T;
            }
          } else {
            return self.handleSingleToolCall(
              null,
              toolArray[0]!,
              message,
              options,
              message.content
            ) as T;
          }
        } else {
          const errorDetail = isMultipleTools
            ? "LLM response content is not a string and no tool calls were made/processed for multiple tools."
            : "LLM response content is not a string and no tool call was made/processed.";
          console.error(
            errorDetail,
            "Raw message:",
            JSON.stringify(message, null, 2)
          );
          return {
            success: false,
            error: new Error(errorDetail),
            raw: message,
          } as T;
        }
      },
    };
  }

  private handleSingleToolCall(
    toolCall: any,
    tool: StructuredTool,
    message: OpenAIMessage,
    options: { includeRaw?: boolean; method?: ToolCallingMethod },
    contentString?: string
  ): StructuredToolInput {
    if (toolCall) {
      if (
        !toolCall ||
        !toolCall.function ||
        typeof toolCall.function.arguments !== "string"
      ) {
        const errorDetail =
          "Tool call or function arguments missing/invalid in LLM response.";
        console.error(
          errorDetail,
          "Raw message:",
          JSON.stringify(message, null, 2)
        );
        return {
          success: false,
          error: new Error(errorDetail),
          raw: message,
        };
      }
      const argsString = toolCall.function.arguments;
      try {
        const parsedArgs = JSON.parse(argsString);
        const validationResult = tool.schema.safeParse(parsedArgs);
        if (validationResult.success) {
          return {
            success: true,
            data: validationResult.data,
            raw: message,
          };
        } else {
          console.error(
            "Zod validation failed for tool call arguments. Error:",
            JSON.stringify(validationResult.error, null, 2)
          );
          console.error(
            "Parsed arguments that failed validation:",
            JSON.stringify(parsedArgs, null, 2)
          );
          return {
            success: false,
            error: validationResult.error,
            raw: message,
          };
        }
      } catch (e: any) {
        console.error(
          "JSON.parse failed for tool call arguments. Error:",
          e.message
        );
        console.error("Arguments string that failed parsing:", argsString);
        return { success: false, error: e, raw: message };
      }
    } else if (contentString) {
      // Handle content string parsing for single tool
      try {
        const parsedContent = JSON.parse(contentString);
        const validationResult = tool.schema.safeParse(parsedContent);
        if (validationResult.success) {
          return {
            success: true,
            data: validationResult.data,
            raw: message,
          };
        } else {
          console.error(
            "Zod validation failed for message content. Error:",
            JSON.stringify(validationResult.error, null, 2)
          );
          console.error(
            "Parsed content that failed validation:",
            JSON.stringify(parsedContent, null, 2)
          );
          return {
            success: false,
            error: validationResult.error,
            raw: message,
          };
        }
      } catch (e: any) {
        console.error(
          "JSON.parse failed for message content. Error:",
          e.message
        );
        console.error("Content string that failed parsing:", contentString);
        return { success: false, error: e, raw: message };
      }
    } else {
      const errorDetail =
        "Tool call or function arguments missing/invalid in LLM response.";
      console.error(
        errorDetail,
        "Raw message:",
        JSON.stringify(message, null, 2)
      );
      return {
        success: false,
        error: new Error(errorDetail),
        raw: message,
      };
    }
  }

  private handleMultipleToolCalls(
    actualToolCalls: any[],
    tools: StructuredTool[],
    message: OpenAIMessage,
    options: { includeRaw?: boolean; method?: ToolCallingMethod }
  ): MultipleStructuredToolInput {
    if (
      !actualToolCalls ||
      !Array.isArray(actualToolCalls) ||
      actualToolCalls.length === 0
    ) {
      const errorDetail =
        "No tool calls found in LLM response for multiple tools.";
      console.error(
        errorDetail,
        "Raw message:",
        JSON.stringify(message, null, 2)
      );
      return {
        success: false,
        error: new Error(errorDetail),
        raw: message,
        toolCalls: [],
      };
    }

    const toolCallResults: Array<{
      toolName: string;
      data: any;
      success: boolean;
      error?: Error | z.ZodError<any>;
    }> = [];

    let overallSuccess = true;
    let overallError: Error | z.ZodError<any> | undefined;

    for (const toolCall of actualToolCalls) {
      if (
        !toolCall ||
        !toolCall.function ||
        typeof toolCall.function.arguments !== "string"
      ) {
        const error = new Error(
          `Tool call or function arguments missing/invalid: ${
            toolCall?.function?.name || "unknown"
          }`
        );
        toolCallResults.push({
          toolName: toolCall?.function?.name || "unknown",
          data: null,
          success: false,
          error,
        });
        overallSuccess = false;
        if (!overallError) overallError = error;
        continue;
      }

      const toolName = toolCall.function.name;
      const tool = tools.find((t) => t.name === toolName);

      if (!tool) {
        const error = new Error(
          `Tool '${toolName}' not found in provided tools`
        );
        toolCallResults.push({
          toolName,
          data: null,
          success: false,
          error,
        });
        overallSuccess = false;
        if (!overallError) overallError = error;
        continue;
      }

      try {
        const parsedArgs = JSON.parse(toolCall.function.arguments);
        const validationResult = tool.schema.safeParse(parsedArgs);

        if (validationResult.success) {
          toolCallResults.push({
            toolName,
            data: validationResult.data,
            success: true,
          });
        } else {
          console.error(
            `Zod validation failed for tool call '${toolName}'. Error:`,
            JSON.stringify(validationResult.error, null, 2)
          );
          toolCallResults.push({
            toolName,
            data: null,
            success: false,
            error: validationResult.error,
          });
          overallSuccess = false;
          if (!overallError) overallError = validationResult.error;
        }
      } catch (e: any) {
        console.error(
          `JSON.parse failed for tool call '${toolName}'. Error:`,
          e.message
        );
        toolCallResults.push({
          toolName,
          data: null,
          success: false,
          error: e,
        });
        overallSuccess = false;
        if (!overallError) overallError = e;
      }
    }

    return {
      success: overallSuccess,
      error: overallError,
      raw: message,
      data: toolCallResults.map((result) => result.data),
      toolCalls: toolCallResults,
    };
  }

  private validateMultipleToolsContent(
    parsedContent: any,
    tools: StructuredTool[],
    message: OpenAIMessage
  ): MultipleStructuredToolInput {
    // If the content is an array, try to validate each item against available tools
    if (Array.isArray(parsedContent)) {
      const toolCallResults: Array<{
        toolName: string;
        data: any;
        success: boolean;
        error?: Error | z.ZodError<any>;
      }> = [];

      let overallSuccess = true;
      let overallError: Error | z.ZodError<any> | undefined;

      for (let i = 0; i < parsedContent.length; i++) {
        const item = parsedContent[i];
        let validated = false;

        // Try to validate against each tool until one succeeds
        for (const tool of tools) {
          const validationResult = tool.schema.safeParse(item);
          if (validationResult.success) {
            toolCallResults.push({
              toolName: tool.name || `tool_${i}`,
              data: validationResult.data,
              success: true,
            });
            validated = true;
            break;
          }
        }

        if (!validated) {
          const error = new Error(
            `Could not validate item ${i} against any provided tool schema`
          );
          toolCallResults.push({
            toolName: `unknown_${i}`,
            data: item,
            success: false,
            error,
          });
          overallSuccess = false;
          if (!overallError) overallError = error;
        }
      }

      return {
        success: overallSuccess,
        error: overallError,
        raw: message,
        data: toolCallResults.map((result) => result.data),
        toolCalls: toolCallResults,
      };
    } else {
      // Single object - try to validate against the first tool or find a matching tool
      for (const tool of tools) {
        const validationResult = tool.schema.safeParse(parsedContent);
        if (validationResult.success) {
          return {
            success: true,
            raw: message,
            data: [validationResult.data],
            toolCalls: [
              {
                toolName: tool.name || "unknown",
                data: validationResult.data,
                success: true,
              },
            ],
          };
        }
      }

      const error = new Error(
        "Could not validate content against any provided tool schema"
      );
      console.error(
        "Content validation failed for all tools. Content:",
        JSON.stringify(parsedContent, null, 2)
      );
      return {
        success: false,
        error,
        raw: message,
        data: [],
        toolCalls: [],
      };
    }
  }
}
