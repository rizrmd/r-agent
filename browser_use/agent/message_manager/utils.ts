import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage
} from '../../models/langchain';
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { Logger } from '../../utils';

const logger = new Logger('message_manager/utils');

export function extractJsonFromModelOutput(content: string): Record<string, any> {
  let processedContent = content;
  try {
    if (processedContent.includes('```')) {
      const parts = processedContent.split('```');
      if (parts.length > 1 && parts[1] !== undefined) {
        processedContent = parts[1];
        if (processedContent.includes('\n')) {
          const subParts = processedContent.split('\n', 2);
          if (subParts.length > 1 && subParts[1] !== undefined) {
            processedContent = subParts[1];
          } else {
            // If split by newline doesn't yield a second part,
            // it might be a single line code block without language specifier.
            // Keep processedContent as is (the content within ```).
          }
        }
      } else {
        // If split by ``` doesn't yield a second part, parsing will likely fail.
        // Let it proceed to JSON.parse to throw the original error.
      }
    }
    return JSON.parse(processedContent);
  } catch (e) {
    logger.warning(`Failed to parse model output: ${content} ${e}`);
    throw new Error('Could not parse response.');
  }
}

export function convertInputMessages(
  inputMessages: BaseMessage[],
  modelName?: string,
  convert?: boolean
): BaseMessage[] {
  if (!modelName) {
    return inputMessages;
  }
  if (convert || modelName === 'deepseek-reasoner' || modelName.includes('deepseek-r1') || modelName.includes('deepseek-v3')) {
    const convertedMessages = convertMessagesForNonFunctionCallingModels(inputMessages);
    let mergedMessages = mergeSuccessiveMessages(convertedMessages, HumanMessage);
    mergedMessages = mergeSuccessiveMessages(mergedMessages, AIMessage);
    return mergedMessages;
  }
  return inputMessages;
}

function convertMessagesForNonFunctionCallingModels(
  inputMessages: BaseMessage[]
): BaseMessage[] {
  return inputMessages.map(message => {
    if (message instanceof HumanMessage || message instanceof SystemMessage) {
      return message;
    }
    if (message instanceof ToolMessage) {
      return new HumanMessage({ content: message.content });
    }
    if (message instanceof AIMessage) {
      if (message.additional_kwargs?.tool_calls) {
        const toolCalls = JSON.stringify(message.additional_kwargs.tool_calls);
        return new AIMessage({ content: toolCalls });
      }
      return message;
    }
    throw new Error(`Unknown message type: ${message.constructor.name}`);
  });
}

function mergeSuccessiveMessages(
  messages: BaseMessage[],
  ClassToMerge: typeof HumanMessage | typeof AIMessage
): BaseMessage[] {
  const mergedMessages: BaseMessage[] = [];
  let streak = 0;

  messages.forEach(message => {
    if (message instanceof ClassToMerge) {
      streak += 1;
      if (streak > 1) {
        const lastMessage = mergedMessages[mergedMessages.length - 1];
        if (lastMessage) { // Check if lastMessage is defined
          let messageContentToAdd = '';
          if (Array.isArray(message.content)) {
            if (message.content.length > 0 && message.content[0] && message.content[0].text) { // Check array and text
              messageContentToAdd = message.content[0].text;
            }
          } else if (typeof message.content === 'string') { // Ensure content is a string before appending
            messageContentToAdd = message.content;
          }

          if (typeof lastMessage.content === 'string' && messageContentToAdd) {
            lastMessage.content += messageContentToAdd;
          } else if (Array.isArray(lastMessage.content) && messageContentToAdd) {
            // If lastMessage.content is an array, decide how to merge.
            // For simplicity, let's assume we append to the text of the first content item if it's text.
            // Or, create a new text content item.
            if (lastMessage.content.length > 0 && lastMessage.content[0]?.type === 'text' && lastMessage.content[0].text) {
              lastMessage.content[0].text += messageContentToAdd;
            } else {
              lastMessage.content.push({ type: 'text', text: messageContentToAdd });
            }
          }
        }
      } else {
        mergedMessages.push(message);
      }
    } else {
      mergedMessages.push(message);
      streak = 0;
    }
  });

  return mergedMessages;
}

export async function saveConversation(
  inputMessages: BaseMessage[],
  response: any,
  target: string,
  encoding?: string
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });

  let content = '';
  content += writeMessagesToString(inputMessages);
  content += writeResponseToString(response);

  await writeFile(target, content, { encoding: encoding || 'utf-8' as any });
}

function writeMessagesToString(messages: BaseMessage[]): string {
  return messages.map(message => {
    let content = ` ${message.constructor.name} \n`;

    if (Array.isArray(message.content)) {
      content += message.content
        .filter(item => item.type === 'text')
        .map(item => item.text!.trim())
        .join('\n');
    } else if (typeof message.content === 'string') {
      try {
        const jsonContent = JSON.parse(message.content);
        content += JSON.stringify(jsonContent, null, 2);
      } catch {
        content += message.content.trim();
      }
    }

    return content + '\n\n';
  }).join('');
}

function writeResponseToString(response: any): string {
  return ' RESPONSE\n' +
    JSON.stringify(
      JSON.parse(response?.toJSON({ excludeUnset: true })),
      null,
      2
    );
}
