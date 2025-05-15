import { BaseChatModel, BaseMessage, formatToolCall, formatTools, RequestParams, StructuredTool } from "./langchain";

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

    formatMessages(rawMessages: BaseMessage[], tool: StructuredTool): RequestParams {
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
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`OpenAI API Error: ${response.status} ${response.statusText}`, errorBody);
            throw new Error(`OpenAI API request failed with status ${response.status}: ${errorBody}`);
        }

        const responseData = await response.json();

        if (!responseData.choices || responseData.choices.length === 0) {
            console.error('OpenAI API Error: No choices returned', responseData);
            throw new Error('OpenAI API request returned no choices.');
        }
        return responseData.choices[0].message;
    }
}
