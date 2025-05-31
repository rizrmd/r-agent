import {
  BaseChatModel,
  BaseMessage,
  Message,
  RequestParams,
  StructuredTool,
  OpenAIMessage,
} from "./langchain";
import { formatTools } from "./langchain";

export interface OllamaOptions {
  num_keep?: number;
  seed?: number;
  num_predict?: number;
  top_k?: number;
  top_p?: number;
  min_p?: number;
  typical_p?: number;
  repeat_last_n?: number;
  temperature?: number;
  repeat_penalty?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  mirostat?: number;
  mirostat_tau?: number;
  mirostat_eta?: number;
  penalize_newline?: boolean;
  stop?: string[];
  numa?: boolean;
  num_ctx?: number;
  num_batch?: number;
  num_gpu?: number;
  main_gpu?: number;
  low_vram?: boolean;
  vocab_only?: boolean;
  use_mmap?: boolean;
  use_mlock?: boolean;
  num_thread?: number;
}

function formatToolCall(
  additional: Message["additional_kwargs"]
): any[] | undefined {
  if (!additional?.["tool_calls"]) {
    return undefined;
  }
  const tool_calls: any[] = [];
  for (const tool_call of additional["tool_calls"]) {
    tool_calls.push({
      name: tool_call.name,
      function: {
        name: tool_call.name,
        arguments: tool_call.args,
      },
      id: tool_call.id,
      type: "function",
    });
  }
  return tool_calls;
}

export class ChatOllama extends BaseChatModel {
  apiKey?: string;
  baseUrl?: string;
  options?: OllamaOptions;

  constructor(params: {
    modelName: string;
    apiKey?: string;
    baseUrl?: string;
    options?: OllamaOptions;
  }) {
    super(params.modelName);
    this.apiKey = params.apiKey;
    this.baseUrl = params.baseUrl || "http://127.0.0.1:11434";
    this.options = params.options;
  }

  formatMessages(
    rawMessages: BaseMessage[],
    tool: StructuredTool
  ): RequestParams {
    const messages: any[] = [];
    for (const m of rawMessages) {
      const newMsg: Record<string, any> = {
        role: "user",
        content: null,
      };
      if (typeof m.content === "string") {
        newMsg.content = m.content;
      } else if (Array.isArray(m.content)) {
        newMsg.content = m.content
          .filter((i) => i.type === "text")
          .map((i) => i.text)
          .join("\n");
        const images = m.content
          .filter((i) => i.type === "image_url")
          .map((i) => i.image_url?.url)
          .filter((i) => i) as string[];
        if (images.length > 0) {
          newMsg.images = images.map((image) => {
            const base64 = image.slice(image.indexOf(",") + 1);
            return base64;
          });
        }
      }

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
      const lastMsg = messages[messages.length - 1];
      // 合并相同角色的消息
      if (lastMsg?.role === newMsg.role) {
        lastMsg.content += "\n" + newMsg.content;
        lastMsg.images = (lastMsg.images || [])?.concat(newMsg.images || []);
      } else {
        messages.push(newMsg);
      }
    }
    let formatedTools: Record<string, any> = {};
    if (tool) {
      formatedTools = formatTools([tool]);
      formatedTools.tool_choice = undefined;
    }
    return { messages, ...formatedTools };
  }

  async request(params: RequestParams): Promise<OpenAIMessage> {
    const url = `${this.baseUrl}/api/chat`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: this.apiKey ? `Bearer ${this.apiKey}` : undefined,
    };
    const body = JSON.stringify({
      ...params,
      model: this.model_name,
      stream: false,
      options: this.options,
    });
    const response = await fetch(url, {
      method: "post",
      headers: headers as any,
      body,
    }).then((response) => response.json());
    return response.message;
  }
}
