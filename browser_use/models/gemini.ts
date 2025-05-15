import { BaseChatModel, BaseMessage, formatTools, RequestParams, StructuredTool, Content } from "./langchain";

// Helper function to clean and transform schema for Gemini
function cleanAndTransformSchemaForGemini(schema: any): any {
    if (typeof schema !== 'object' || schema === null) {
        return schema;
    }

    if (Array.isArray(schema)) {
        return schema.map(item => cleanAndTransformSchemaForGemini(item));
    }

    const newSchema: any = {};
    for (const key in schema) {
        if (key === '$schema' || key === 'additionalProperties' || key === '$ref') {
            continue; // Skip these problematic keys for Gemini
        }

        const value = schema[key];
        if (key === 'type' && typeof value === 'string') {
            // Gemini expects type names in uppercase (e.g., "STRING", "OBJECT")
            newSchema[key] = value.toUpperCase();
        } else {
            newSchema[key] = cleanAndTransformSchemaForGemini(value);
        }
    }
    return newSchema;
}

export class ChatGeminiAI extends BaseChatModel {
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
        this.baseUrl = params.baseUrl || 'https://generativelanguage.googleapis.com/v1beta/models';
    }

    formatMessages(rawMessages: BaseMessage[], tool?: StructuredTool): RequestParams {
        const geminiContents: any[] = [];
        const systemInstructions: string[] = [];

        for (const m of rawMessages) {
            let currentMessageTextContent = "";
            if (typeof m.content === 'string') {
                currentMessageTextContent = m.content;
            } else if (Array.isArray(m.content)) {
                // Handle Content[] by concatenating text parts
                currentMessageTextContent = (m.content as Content[])
                    .filter(part => part.type === "text" && typeof part.text === 'string')
                    .map(part => (part.text as string))
                    .join("\n");
            } else if (m.content === null) {
                 // If content is null (e.g. for AI tool calls or empty messages), treat text as empty
                currentMessageTextContent = "";
            }
            // else: m.content might be some other type not handled for text, defaults to ""

            if (m.type === 'human') {
                geminiContents.push({ role: 'user', parts: [{ text: currentMessageTextContent }] });
            } else if (m.type === 'ai') {
                if (m.additional_kwargs && m.additional_kwargs.tool_calls) {
                    const toolCalls = m.additional_kwargs.tool_calls;
                    for (const tc of toolCalls) {
                        geminiContents.push({
                            role: 'model',
                            parts: [{
                                functionCall: {
                                    name: tc.name,
                                    args: tc.args,
                                }
                            }]
                        });
                    }
                } else {
                    geminiContents.push({ role: 'model', parts: [{ text: currentMessageTextContent }] });
                }
            } else if (m.type === 'tool') {
                geminiContents.push({
                    role: 'tool', // Corrected role for tool messages
                    parts: [{
                        functionResponse: {
                            name: m.tool_call_id, 
                            response: { content: m.content }, // Tool response content can be complex
                        }
                    }]
                });
            } else if (m.type === 'system') {
                systemInstructions.push(m.content as string);
            }
        }

        const outputParams: RequestParams & { _gemini_system_instruction?: any } = {
            messages: geminiContents, // Gemini 'contents' are placed in 'messages' for RequestParams compatibility
        };

        if (systemInstructions.length > 0) {
            outputParams._gemini_system_instruction = { parts: [{ text: systemInstructions.join("\n") }] };
        }

        if (tool) {
            const langchainFormattedTools = formatTools([tool]);
            if (langchainFormattedTools.tools && langchainFormattedTools.tools.length > 0) {
                const geminiFunctionDeclarations = langchainFormattedTools.tools.map((t: any) => {
                    const toolFunction = t.function;
                    const cleanedParams = toolFunction.parameters
                        ? cleanAndTransformSchemaForGemini(toolFunction.parameters)
                        : undefined;
                    return {
                        name: toolFunction.name,
                        description: toolFunction.description,
                        parameters: cleanedParams,
                    };
                });
                outputParams.tools = [{ functionDeclarations: geminiFunctionDeclarations }];
            }
            // tool_choice from langchainFormattedTools is not directly used for Gemini in this setup.
            // Gemini's tool configuration is typically part of the 'tools' array (e.g. mode AUTO/ANY/NONE)
            // or handled by the absence/presence of functionDeclarations.
        }
        return outputParams;
    }

    async request(params: RequestParams) { // Accepts RequestParams to be compatible with BaseChatModel
        const geminiSystemInstruction = (params as any)._gemini_system_instruction;

        const bodyForGemini = {
            contents: params.messages, // These are the geminiContents from formatMessages
            ...(params.tools && { tools: params.tools }), // These are Gemini-formatted tools from formatMessages
            ...(geminiSystemInstruction && { system_instruction: geminiSystemInstruction }),
            generationConfig: {
                temperature: this.temperature,
            }
        };

        const url = `${this.baseUrl}/${this.model_name}:generateContent?key=${this.apiKey}`;
        const headers = {
            'Content-Type': 'application/json',
        };
        const body = JSON.stringify(bodyForGemini);
        const response = await fetch(url, {
            method: 'post',
            headers,
            body,
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Gemini API Error: ${response.status} ${response.statusText}`, errorBody);
            throw new Error(`Gemini API request failed with status ${response.status}: ${errorBody}`);
        }

        const responseData = await response.json();

        // Gemini API response structure is different
        // It typically has a `candidates` array
        if (!responseData.candidates || responseData.candidates.length === 0) {
            console.error('Gemini API Error: No candidates returned', responseData);
            throw new Error('Gemini API request returned no candidates.');
        }
        // Assuming the first candidate's content is what we need.
        // The structure is responseData.candidates[0].content.parts[0].text for simple text
        // or responseData.candidates[0].content.parts[0].functionCall for tool calls
        const candidate = responseData.candidates[0];
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
            const part = candidate.content.parts[0];
            if (part.text) {
                return { role: 'assistant', content: part.text };
            } else if (part.functionCall) {
                // Adapt this to how Langchain expects tool calls
                return {
                    role: 'assistant',
                    content: null, // Or some placeholder
                    additional_kwargs: {
                        tool_calls: [{
                            id: '', // Gemini might not provide an ID in the same way, adapt as needed
                            type: 'function',
                            function: {
                                name: part.functionCall.name,
                                arguments: JSON.stringify(part.functionCall.args),
                            },
                        }],
                    },
                };
            }
        }
        // Fallback or further error handling if the expected structure isn't found
        console.error('Gemini API Error: Unexpected response structure', responseData);
        throw new Error('Gemini API request returned an unexpected structure.');
    }
}
