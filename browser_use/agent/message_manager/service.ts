import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "../../models/langchain";
import { Logger } from "../../utils";
import { MessageManagerState } from "./views";
import { ActionResult, AgentOutput, AgentStepInfo } from "../views";
import { BrowserState } from "../../browser/views";
import { AgentMessagePrompt } from "../prompts";
import { timeExecutionSync } from "../../utils";

const logger = new Logger("message_manager/service");

export interface MessageManagerSettings {
  max_input_tokens: number;
  estimated_characters_per_token?: number;
  image_tokens?: number;
  include_attributes: string[];
  message_context?: string;
  sensitive_data?: Record<string, string>;
  available_file_paths?: string[];
}

export class MessageManager {
  private task: string;
  settings!: MessageManagerSettings;
  state: MessageManagerState;
  private system_prompt: SystemMessage;

  constructor(options: {
    task: string;
    system_message: SystemMessage;
    settings?: MessageManagerSettings;
    state?: MessageManagerState;
  }) {
    this.task = options.task;
    this.settings = options.settings || {
      max_input_tokens: 128000,
      estimated_characters_per_token: 3,
      image_tokens: 800,
      include_attributes: [],
    };
    this.state = options.state || new MessageManagerState();
    this.system_prompt = options.system_message;

    // Only initialize messages if state is empty
    if (this.state.history.messages.length === 0) {
      this._init_messages();
    }
  }

  private _init_messages(): void {
    this._add_message_with_tokens(this.system_prompt);

    if (this.settings.message_context) {
      const context_message = new HumanMessage({
        content: "Context for the task" + this.settings.message_context,
      });
      this._add_message_with_tokens(context_message);
    }

    const task_message = new HumanMessage({
      content: `Your ultimate task is: """${this.task}""". If you achieved your ultimate task, stop everything and use the done action in the next step to complete the task. If not, continue as usual.`,
    });
    this._add_message_with_tokens(task_message);

    if (this.settings.sensitive_data) {
      let info = `Here are placeholders for sensitve data: ${Object.keys(
        this.settings.sensitive_data
      )}`;
      info += "To use them, write <secret>the placeholder name</secret>";
      const info_message = new HumanMessage({ content: info });
      this._add_message_with_tokens(info_message);
    }

    const placeholder_message = new HumanMessage({
      content: "Example output:",
    });
    this._add_message_with_tokens(placeholder_message);

    const tool_calls = [
      {
        name: "AgentOutput",
        args: {
          current_state: {
            evaluation_previous_goal: "Success - I opend the first page",
            memory: "Starting with the new task. I have completed 1/10 steps",
            next_goal: "Click on company a",
          },
          action: [{ click_element: { index: 0 } }],
        },
        id: String(this.state.tool_id),
        type: "tool_call",
      },
    ];

    const example_tool_call = new AIMessage({
      content: "",
      additional_kwargs: { tool_calls },
    });
    this._add_message_with_tokens(example_tool_call);
    this.add_tool_message("Browser started");

    const placeholder_message2 = new HumanMessage({
      content: "[Your task history memory starts here]",
    });
    this._add_message_with_tokens(placeholder_message2);

    if (this.settings.available_file_paths) {
      const filepaths_msg = new HumanMessage({
        content: `Here are file paths you can use: ${this.settings.available_file_paths}`,
      });
      this._add_message_with_tokens(filepaths_msg);
    }
  }

  public add_new_task(new_task: string): void {
    const content = `Your new ultimate task is: """${new_task}""". Take the previous context into account and finish your new ultimate task. `;
    const msg = new HumanMessage({ content });
    this._add_message_with_tokens(msg);
    this.task = new_task;
  }

  @timeExecutionSync("--add_state_message")
  public add_state_message(
    state: BrowserState,
    result?: ActionResult[],
    step_info?: AgentStepInfo,
    use_vision: boolean = true,
    previous_brain?: AgentOutput['current_state']
  ): void {
    // if keep in memory, add directly to history and add state without result
    if (result) {
      for (const r of result) {
        if (r.include_in_memory) {
          if (r.extracted_content) {
            const msg = new HumanMessage({
              content: "Action result: " + String(r.extracted_content),
            });
            this._add_message_with_tokens(msg);
          }
          if (r.error) {
            let error = r.error;
            if (error.endsWith("\n")) {
              error = error.slice(0, -1);
            }
            const last_line = error.split("\n").pop() || "";
            const msg = new HumanMessage({
              content: "Action error: " + last_line,
            });
            this._add_message_with_tokens(msg);
          }
          result = undefined; // if result in history, we don't want to add it again
        }
      }
    }

    // otherwise add state message and result to next message (which will not stay in memory)
    const state_message = new AgentMessagePrompt(
      state,
      result,
      this.settings.include_attributes,
      step_info,
      previous_brain
    ).getUserMessage(use_vision);

    this._add_message_with_tokens(state_message);
  }

  public add_model_output(model_output: AgentOutput): void {
    const tool_calls = [
      {
        name: "AgentOutput",
        args: model_output,
        id: String(this.state.tool_id),
        type: "tool_call",
      },
    ];

    const msg = new AIMessage({
      content: "",
      additional_kwargs: { tool_calls },
    });

    this._add_message_with_tokens(msg);
    // empty tool response
    this.add_tool_message("");
  }

  public add_plan(plan?: string, position?: number): void {
    if (plan) {
      const msg = new AIMessage({ content: plan });
      this._add_message_with_tokens(msg, position);
    }
  }

  @timeExecutionSync("--get_messages")
  public get_messages(): BaseMessage[] {
    const msg = this.state.history.messages.map((m) => m.message);

    // debug which messages are in history with token count
    let total_input_tokens = 0;
    logger.debug(`Messages in history: ${this.state.history.messages.length}:`);

    for (const m of this.state.history.messages) {
      total_input_tokens += m.metadata.tokens;
      logger.debug(
        `${m.message.constructor.name} - Token count: ${m.metadata.tokens}`
      );
    }

    logger.debug(`Total input tokens: ${total_input_tokens}`);
    return msg;
  }

  public add_message_with_tokens(msg: { role: string; content: any }): void {
    const message = new BaseMessage(msg);
    this._add_message_with_tokens(message);
  }

  private _add_message_with_tokens(
    message: BaseMessage,
    position?: number
  ): void {
    // filter out sensitive data from the message
    if (this.settings.sensitive_data) {
      message = this._filter_sensitive_data(message);
    }

    const token_count = this._count_tokens(message);
    const metadata = { tokens: token_count };
    this.state.history.addMessage(message, metadata, position);
  }

  @timeExecutionSync("--filter_sensitive_data")
  private _filter_sensitive_data(message: BaseMessage): BaseMessage {
    const replace_sensitive = (value: string): string => {
      if (!this.settings.sensitive_data) {
        return value;
      }

      for (const [key, val] of Object.entries(this.settings.sensitive_data)) {
        if (!val) {
          continue;
        }
        value = value.replace(val, `<secret>${key}</secret>`);
      }
      return value;
    };

    if (typeof message.content === "string") {
      message.content = replace_sensitive(message.content);
    } else if (Array.isArray(message.content)) {
      for (let i = 0; i < message.content.length; i++) {
        const item = message.content[i];
        if (typeof item === "object" && "text" in item) {
          item.text = replace_sensitive(item.text!);
          message.content[i] = item;
        }
      }
    }

    return message;
  }

  private _count_tokens(message: BaseMessage): number {
    let tokens = 0;

    if (Array.isArray(message.content)) {
      for (const item of message.content) {
        if ("image_url" in item) {
          tokens += this.settings.image_tokens || 0;
        } else if (typeof item === "object" && "text" in item) {
          tokens += this._count_text_tokens(item.text || "");
        }
      }
    } else {
      let msg = message.content as string;
      if (
        "additional_kwargs" in message &&
        message.additional_kwargs?.tool_calls
      ) {
        msg += JSON.stringify(message.additional_kwargs.tool_calls);
      }
      tokens += this._count_text_tokens(msg);
    }

    return tokens;
  }

  private _count_text_tokens(text: string): number {
    // Rough estimate if no tokenizer available
    return Math.floor(
      text.length / (this.settings.estimated_characters_per_token || 1)
    );
  }

  public cut_messages(): void {
    const diff =
      this.state.history.current_tokens - this.settings.max_input_tokens;
    if (diff <= 0) {
      return;
    }

    const msg =
      this.state.history.messages[this.state.history.messages.length - 1];

    if (!msg || !msg.message || !msg.metadata) {
      // Added null checks for msg, msg.message and msg.metadata
      logger.warn(
        "cut_messages: Last message or its properties are undefined."
      );
      return;
    }

    // if list with image remove image
    if (Array.isArray(msg.message.content)) {
      let text = "";

      for (let i = 0; i < msg.message.content.length; i++) {
        const item = msg.message.content[i];

        if (item && "image_url" in item) {
          // Added null check for item
          msg.message.content.splice(i, 1);
          i--;
          msg.metadata.tokens -= this.settings.image_tokens!;
          this.state.history.current_tokens -= this.settings.image_tokens!;
          logger.debug(
            `Removed image with ${this.settings.image_tokens} tokens - total tokens now: ${this.state.history.current_tokens}/${this.settings.max_input_tokens}`
          );
        } else if (item && "text" in item && typeof item === "object") {
          // Added null check for item
          text += item.text;
        }
      }

      msg.message.content = text;
      // Ensure msg is still valid before assignment, though it should be if we reached here.
      if (this.state.history.messages.length > 0) {
        this.state.history.messages[this.state.history.messages.length - 1] =
          msg;
      }
    }

    if (
      this.state.history.current_tokens - this.settings.max_input_tokens <=
      0
    ) {
      return;
    }

    // Calculate the proportion of content to remove
    const proportion_to_remove = diff / msg.metadata.tokens; // msg.metadata is checked above
    if (proportion_to_remove > 0.99) {
      throw new Error(
        `Max token limit reached - history is too long - reduce the system prompt or task. ` +
          `proportion_to_remove: ${proportion_to_remove}`
      );
    }

    logger.debug(
      `Removing ${proportion_to_remove * 100}% of the last message (${
        proportion_to_remove * msg.metadata.tokens
      } / ${msg.metadata.tokens} tokens)` // msg.metadata is checked
    );

    const content = msg.message.content as string; // msg.message is checked above
    const characters_to_remove = Math.floor(
      content.length * proportion_to_remove
    );
    const truncated_content = content.slice(0, -characters_to_remove);

    // remove tokens and old long message
    this.state.history.removeLastStateMessage();

    // new message with updated content
    const new_msg = new HumanMessage({ content: truncated_content });
    this._add_message_with_tokens(new_msg);

    const last_msg =
      this.state.history.messages[this.state.history.messages.length - 1];

    if (last_msg && last_msg.metadata) {
      // Added null check for last_msg and last_msg.metadata
      logger.debug(
        `Added message with ${last_msg.metadata.tokens} tokens - total tokens now: ` +
          `${this.state.history.current_tokens}/${this.settings.max_input_tokens} - ` +
          `total messages: ${this.state.history.messages.length}`
      );
    } else {
      logger.warn(
        "cut_messages: last_msg or its metadata is undefined after truncation and re-adding."
      );
    }
  }

  removeLastStateMessage(): void {
    this.state.history.removeLastStateMessage();
  }

  public add_tool_message(content: string): void {
    const msg = new ToolMessage({
      content,
      tool_call_id: String(this.state.tool_id),
    });

    this.state.tool_id += 1;
    this._add_message_with_tokens(msg);
  }
}
