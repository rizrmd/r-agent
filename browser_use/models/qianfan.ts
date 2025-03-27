import { BaseChatModel, BaseMessage, Message, RequestParams, StructedTool } from "./langchain";
import { formatToolCall, formatTools } from "./openai";
import fs from 'fs';

/**
 * ernie 4.0 chat
 */
export class ChatQianfan extends BaseChatModel {
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
        this.baseUrl = params.baseUrl || 'https://qianfan.baidubce.com/v2';
    }

    formatMessages(rawMessages: BaseMessage[], tool: StructedTool): RequestParams {
        const messages: Message[] = [];
        let lastMsg: Message | undefined;
        for (const m of rawMessages) {
            const newMsg: Message = {
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
                if (!newMsg.content) {
                    newMsg.content = 'Done';
                }
            }
            else if (m.type === 'system') {
                newMsg.role = 'system';
            }

            // 适配 千帆 不支持连续对话的问题
            if (lastMsg?.role === newMsg.role) {
                if (Array.isArray(newMsg.content) && Array.isArray(lastMsg.content)) {
                    lastMsg.content.push(...newMsg.content);
                    continue;
                }
                else if (Array.isArray(newMsg.content) && typeof lastMsg.content === 'string') {
                    newMsg.content[0].text = lastMsg.content + newMsg.content[0].text;
                    messages.pop();
                    messages.push(lastMsg = newMsg);
                    continue;
                }
                else if (typeof newMsg.content === 'string') {
                    if (typeof lastMsg.content === 'string') {
                        lastMsg.content += newMsg.content;
                        continue;
                    }
                }
            }
            messages.push(lastMsg = newMsg);
            // tool 后面加一个 assistant 消息
            if (newMsg.role === 'tool') {
                const assistantMsg = {
                    role: 'assistant',
                    content: '',
                };
                messages.push(lastMsg = assistantMsg);
            }
        }
        return {messages, ...(tool ? formatTools([tool]):{})};
    }

    async request(options: RequestParams) {
        const url = `${this.baseUrl}/chat/completions`;
        const auth = `Bearer ${this.apiKey}`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': auth
        };
        const body = JSON.stringify({
            ...options,
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