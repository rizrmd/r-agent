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
  try {
    if (content.includes('```')) {
      content = content.split('```')[1];
      if (content.includes('\n')) {
        content = content.split('\n', 2)[1];
      }
    }
    return JSON.parse(content);
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
        if (Array.isArray(message.content)) {
          lastMessage.content += message.content[0].text!;
        } else {
          lastMessage.content += message.content;
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