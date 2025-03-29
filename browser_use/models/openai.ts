import { BaseChatModel, BaseMessage, Message, RequestParams, StructedTool } from "./langchain";

import { zodToJsonSchema } from "zod-to-json-schema";


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

export class ChatOpenAI extends BaseChatModel {
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
        this.baseUrl = params.baseUrl || 'https://api.openai.com/v1';
    }

    formatMessages(rawMessages: BaseMessage[], tool: StructedTool): RequestParams {
        const messages: any[] = [];
        for (const m of rawMessages) {
            const newMsg: Record<string, any> = {
                role: 'user',
                content: m.content,
            };
            if (m.type === 'human') {
                newMsg.role = 'user';
            }
            else if (m.type === 'ai') {
                newMsg.role = 'assistant';
                if (m.additional_kwargs) {
                    newMsg.tool_calls = formatToolCall(m.additional_kwargs)
                }
            }
            else if (m.type === 'tool') {
                newMsg.role = 'tool';
                newMsg.tool_call_id = m.tool_call_id;
            }
            else if (m.type === 'system') {
                newMsg.role = 'system';
            }
            messages.push(newMsg);
        }
        return {messages, ...(tool ? formatTools([tool]):{})};
    }

    async request(params: RequestParams) {
        const url = `${this.baseUrl}/chat/completions`;
        const auth = `Bearer ${this.apiKey}`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': auth
        };
        const body = JSON.stringify({
            ...params,
            model: this.model_name,
        });
        const response = await fetch(url, {
            method: 'post',
            headers,
            body,
        }).then(response => response.json());
        return response.choices[0].message;
    }
}