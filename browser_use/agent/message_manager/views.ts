import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage
} from '../../models/langchain';
import { AgentOutput } from '../views';

export interface MessageMetadata {
  tokens: number;
}

export class ManagedMessage {
  constructor(
    public message: BaseMessage,
    public metadata: MessageMetadata = { tokens: 0 }
  ) { }

  toJSON() {
    return {
      message: this.message?.toJSON(),
      metadata: this.metadata
    };
  }

  static fromJSON(data: any): ManagedMessage {
    const messageData = data.message;
    let message: BaseMessage;

    switch (messageData._type) {
      case 'ai':
        message = AIMessage.fromJSON(messageData);
        break;
      case 'human':
        message = HumanMessage.fromJSON(messageData);
        break;
      case 'system':
        message = SystemMessage.fromJSON(messageData);
        break;
      case 'tool':
        message = ToolMessage.fromJSON(messageData);
        break;
      default:
        throw new Error(`Unknown message type: ${messageData._type}`);
    }

    return new ManagedMessage(
      message,
      { tokens: data.metadata.tokens }
    );
  }
}

export class MessageHistory {
  public messages: ManagedMessage[] = [];
  public current_tokens: number = 0;

  addMessage(
    message: BaseMessage,
    metadata: MessageMetadata,
    position?: number
  ): void {
    const managedMessage = new ManagedMessage(message, metadata);
    if (position === undefined) {
      this.messages.push(managedMessage);
    } else {
      this.messages.splice(position, 0, managedMessage);
    }
    this.current_tokens += metadata.tokens;
  }

  addModelOutput(output: AgentOutput): void {
    const tool_calls = [{
      name: 'AgentOutput',
      args: output,
      id: '1',
      type: 'tool_call'
    }];

    const msg = new AIMessage({
      content: '',
      additional_kwargs: { tool_calls }
    });
    this.addMessage(msg, { tokens: 100 });

    const toolMessage = new ToolMessage({
      content: '',
      tool_call_id: '1'
    });
    this.addMessage(toolMessage, { tokens: 10 });
  }

  getMessages(): BaseMessage[] {
    return this.messages.map(m => m.message);
  }

  getTotalTokens(): number {
    return this.current_tokens;
  }

  removeOldestMessage(): void {
    const index = this.messages.findIndex(msg =>
      !(msg.message instanceof SystemMessage)
    );
    if (index !== -1) {
      const messageToRemove = this.messages[index];
      if (messageToRemove && messageToRemove.metadata) {
        this.current_tokens -= messageToRemove.metadata.tokens;
      }
      this.messages.splice(index, 1);
    }
  }

  removeLastStateMessage(): void {
    if (this.messages.length > 2) {
      const lastMessage = this.messages[this.messages.length - 1];
      if (lastMessage && lastMessage.message instanceof HumanMessage && lastMessage.metadata) {
        this.current_tokens -= lastMessage.metadata.tokens;
        this.messages.pop();
      }
    }
  }
}

export class MessageManagerState {
  constructor(
    public history: MessageHistory = new MessageHistory(),
    public tool_id: number = 1
  ) { }
}
