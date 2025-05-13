import z from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

type ToolCallingMethod =
  | "auto"
  | "function_calling"
  | "json_mode"
  | "raw"
  | null
  | undefined;

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

export class StructedTool {
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
  tools?: any[];
  tool_choice?: any;
  messages: any[];
}

export function formatToolCall(
  additional: Message["additional_kwargs"]
): any[] | undefined {
  if (!additional?.tool_calls) {
    return undefined;
  }
  const formatted_tool_calls: any[] = [];
  for (const tool_call_item of additional.tool_calls) {
    let args_string: string;

    if (typeof tool_call_item.args === 'string') {
      // Attempt to sanitize if it's already a string and potentially malformed
      args_string = tool_call_item.args.replace(/}\/function"?$/, '}');
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
      id: tool_call_item.id, // Ensure id is present
      type: "function",
      function: {
        name: tool_call_item.name,
        arguments: args_string,
      },
    });
  }
  return formatted_tool_calls;
}

export function formatTools(rawTools: StructedTool[]): {
  tools?: any[];
  tool_choice?: any;
} {
  if (!rawTools?.length) {
    return {};
  }
  const tools: any[] = [];
  for (const tool of rawTools) {
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
  const tool_choice = rawTools[0]?.name
    ? {
        // Added check for rawTools[0].name
        type: "function",
        function: {
          name: rawTools[0].name,
        },
      }
    : undefined;
  return { tools, tool_choice };
}

export class BaseChatModel {
  model_name: string;
  outputSchema?: z.ZodType<any>;
  constructor(model_name: string) {
    this.model_name = model_name;
  }

  request(params: RequestParams): Promise<any> {
    throw new Error("Not implemented");
  }

  formatMessages(messages: BaseMessage[], tool?: StructedTool): RequestParams {
    return { messages };
  }

  async invoke<T = any>(rawMessages: BaseMessage[]): Promise<T> {
    const result = await this.request(this.formatMessages(rawMessages));
    return result as T;
  }

  withStructuredOutput(
    tool: StructedTool,
    options: { includeRaw?: boolean; method?: ToolCallingMethod }
  ) {
    const self = this;
    return {
      async invoke<T = any>(rawMessages: BaseMessage[]): Promise<T> {
        const message = await self.request(
          self.formatMessages(rawMessages, tool)
        );

        // Check for tool calls, potentially nested in additional_kwargs
        let actualToolCalls = message.tool_calls;
        if (!actualToolCalls && message.additional_kwargs?.tool_calls) {
          actualToolCalls = message.additional_kwargs.tool_calls;
        }

        if (actualToolCalls || options?.method === "function_calling") {
          const toolCall = actualToolCalls?.[0];
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
            } as T;
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
              } as T;
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
              } as T;
            }
          } catch (e: any) {
            console.error(
              "JSON.parse failed for tool call arguments. Error:",
              e.message
            );
            console.error("Arguments string that failed parsing:", argsString);
            return { success: false, error: e, raw: message } as T;
          }
        }

        if (typeof message.content === "string") {
          try {
            const parsedContent = JSON.parse(message.content);
            const validationResult = tool.schema.safeParse(parsedContent);
            if (validationResult.success) {
              return {
                success: true,
                data: validationResult.data,
                raw: message,
              } as T;
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
              } as T;
            }
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
          const errorDetail =
            "LLM response content is not a string and no tool call was made/processed.";
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
}
