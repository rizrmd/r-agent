import z from 'zod';
import { zodToJsonSchema } from "zod-to-json-schema";

type ToolCallingMethod = 'auto' | 'function_calling' | 'json_mode' | 'raw' | null | undefined;

export interface Content {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
        url: string;
    }
}

export interface Message {
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
        }>
    }
}

export class StructedTool {
    name?: string;
    description?: string;
    schema: z.ZodType<any>;
}

export class BaseMessage implements Message {
    type: string = '';
    role?: string;
    content: string | Content[];
    tool_call_id?: string;
    additional_kwargs?: Message['additional_kwargs'];

    constructor(data: Message) {
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
            additional_kwargs: this.additional_kwargs
        };
    }
}

export class HumanMessage extends BaseMessage {
    type: string = 'human';
    static fromJSON(data: Message): HumanMessage {
        return new HumanMessage(data);
    }
}
export class AIMessage extends BaseMessage {
    type: string = 'ai';
    static fromJSON(data: Message): AIMessage {
        return new AIMessage(data);
    }
}
export class SystemMessage extends BaseMessage {
    type: string = 'system';
    static fromJSON(data: Message): SystemMessage {
        return new SystemMessage(data);
    }
}
export class ToolMessage extends BaseMessage {
    type: string = 'tool';
    static fromJSON(data: Message): ToolMessage {
        return new ToolMessage(data);
    }
}

export interface RequestParams {
    tools?: any[];
    tool_choice?: any;
    messages: any[];
}

export function formatToolCall(additional: Message['additional_kwargs']): any[] | undefined {
    if (!additional?.['tool_calls']) {
        return undefined;
    }
    const tool_calls: any[] = [];
    for (const tool_call of additional['tool_calls']) {
        tool_calls.push({
            name: tool_call.name,
            function: {
                name: tool_call.name,
                arguments: JSON.stringify(tool_call.args)
            },
            id: tool_call.id,
            type: 'function'
        });
    }
    return tool_calls;
}


export function formatTools(rawTools: StructedTool[]): {tools?: any[], tool_choice?: any} {
    if (!rawTools?.length) {
        return {};
    }
    const tools: any[] = [];
    for (const tool of rawTools) {
        const jsonschema = zodToJsonSchema(tool.schema);
        tools.push({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: jsonschema
            }
        });
    }
    const tool_choice = {
        type: 'function',
        function: {
            name: rawTools[0].name
        }
    };
    return {tools, tool_choice};
}


export class BaseChatModel {
    model_name: string;
    outputSchema?: z.ZodType<any>;
    constructor(model_name: string) {
        this.model_name = model_name;
    }

    request(params: RequestParams): Promise<any> {
        throw new Error('Not implemented');
    }

    formatMessages(messages: BaseMessage[], tool?: StructedTool): RequestParams {
        return {messages};
    }


    async invoke<T = any>(rawMessages: BaseMessage[]): Promise<T> {
        const result = await this.request(this.formatMessages(rawMessages));
        return result as T;
    }

    withStructuredOutput(tool: StructedTool, options: { includeRaw?: boolean, method?: ToolCallingMethod }) {
        const self = this;
        return {
            async invoke<T = any>(rawMessages: BaseMessage[]): Promise<T> {
                const message = await self.request(self.formatMessages(rawMessages, tool));
                if (message.tool_calls || options?.method === 'function_calling') {
                    const args = message.tool_calls?.[0]?.function?.arguments || message.content;
                    if (!args) {
                        return null;
                    }
                    return tool.schema.safeParse(typeof args === 'string' ? JSON.parse(args) : args) as T;
                }
                return tool.schema.safeParse(JSON.parse(message.content)) as T;
            }
        }
    }
}
