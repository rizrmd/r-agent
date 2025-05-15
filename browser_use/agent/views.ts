import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { BaseChatModel } from '../models/langchain';
import { MessageManagerState, MessageHistory } from './message_manager/views';
import { BrowserStateHistory } from '../browser/views';
import {
  SerializableAgentState,
  SerializableMessageManagerState,
  SerializableMessageHistory,
  SerializableAgentHistoryList,
  SerializableAgentHistoryItem
} from './serializable_views';
import {
  DOMElementNode,
  DOMHistoryElement,
  HistoryTreeProcessor
} from '../dom/history_tree_processor/service';
import { SelectorMap } from '../dom/views';

export type ToolCallingMethod = 'function_calling' | 'json_mode' | 'raw' | 'auto';

export { ActionModel } from '../controller/registry/views';

export class AgentSettings {
  use_vision: boolean = true;
  use_vision_for_planner: boolean = false;
  save_conversation_path?: string = undefined;
  save_conversation_path_encoding?: string = 'utf-8';
  max_failures: number = 3;
  retry_delay: number = 10;
  max_input_tokens: number = 128000;
  validate_output: boolean = false;
  message_context?: string = undefined;
  generate_gif: boolean | string = false;
  available_file_paths?: string[] = undefined;
  override_system_message?: string = undefined;
  extend_system_message?: string = undefined;
  include_attributes: string[] = [
    'title',
    'type',
    'name',
    'role',
    'tabindex',
    'aria-label',
    'placeholder',
    'value',
    'alt',
    'aria-expanded',
  ];
  max_actions_per_step: number = 10;
  tool_calling_method?: ToolCallingMethod = 'auto';
  page_extraction_llm?: BaseChatModel = undefined;
  planner_llm?: BaseChatModel = undefined;
  planner_interval: number = 1; // Run planner every N steps

  constructor(data?: Partial<AgentSettings>) {
    Object.assign(this, data || {});
  }
}

export class AgentState {
  agent_id: string = uuidv4();
  n_steps: number = 1;
  consecutive_failures: number = 0;
  last_result?: ActionResult[] = undefined;
  history: AgentHistoryList;
  last_plan?: string = undefined;
  paused: boolean = false;
  stopped: boolean = false;
  message_manager_state: MessageManagerState;

  constructor(data?: Partial<AgentState>) {
    this.history = new AgentHistoryList({ history: [] });
    this.message_manager_state = new MessageManagerState();
    Object.assign(this, data || {});
  }

  toSerializable(): SerializableAgentState {
    const serializableMessageHistory: SerializableMessageHistory = {
      messages: this.message_manager_state.history.messages.map(m => m.toJSON()),
      current_tokens: this.message_manager_state.history.current_tokens,
    };

    const serializableMessageManagerState: SerializableMessageManagerState = {
      history: serializableMessageHistory,
      tool_id: this.message_manager_state.tool_id,
    };

    return {
      agent_id: this.agent_id,
      n_steps: this.n_steps,
      consecutive_failures: this.consecutive_failures,
      last_result: this.last_result ? JSON.parse(JSON.stringify(this.last_result)) : undefined,
      history: this.history.toJSON(), // Leverages existing AgentHistoryList.toJSON()
      last_plan: this.last_plan,
      paused: this.paused,
      stopped: this.stopped,
      message_manager_state: serializableMessageManagerState,
    };
  }

  static fromSerializable(data: SerializableAgentState, outputModel: z.ZodType<any>): AgentState {
    const agentState = new AgentState(); // Initializes default history and message_manager_state

    agentState.agent_id = data.agent_id;
    agentState.n_steps = data.n_steps;
    agentState.consecutive_failures = data.consecutive_failures;
    agentState.last_result = data.last_result ? JSON.parse(JSON.stringify(data.last_result)) : undefined;
    agentState.last_plan = data.last_plan;
    agentState.paused = data.paused;
    agentState.stopped = data.stopped;

    // Reconstruct MessageManagerState
    agentState.message_manager_state = MessageManagerState.fromSerializable(data.message_manager_state);
    
    // Reconstruct AgentHistoryList
    agentState.history = AgentHistoryList.fromSerializable(data.history, outputModel);

    return agentState;
  }
}

export class AgentStepInfo {
  step_number: number;
  max_steps: number;

  constructor(step_number: number, max_steps: number) {
    this.step_number = step_number;
    this.max_steps = max_steps;
  }

  is_last_step(): boolean {
    return this.step_number >= this.max_steps - 1;
  }
}

export const ActionResultSchema = z.object({
  is_done: z.boolean().optional(),
  success: z.boolean().optional(),
  extracted_content: z.string().optional(),
  error: z.string().optional(),
  include_in_memory: z.boolean().optional(),
})
export type ActionResult = z.infer<typeof ActionResultSchema>;

export class StepMetadata {
  step_start_time: number;
  step_end_time: number;
  input_tokens: number; // Approximate tokens from message manager for this step
  step_number: number;

  constructor(data: {
    step_start_time: number;
    step_end_time: number;
    input_tokens: number;
    step_number: number;
  }) {
    this.step_start_time = data.step_start_time;
    this.step_end_time = data.step_end_time;
    this.input_tokens = data.input_tokens;
    this.step_number = data.step_number;
  }

  get duration_seconds(): number {
    return this.step_end_time - this.step_start_time;
  }
}


export const AgentBrainSchema = z.object({
  evaluation_previous_goal: z.string(),
  memory: z.string(),
  next_goal: z.string(),
}, {
  description: 'Current state of the agent'
});

export type AgentBrain = z.infer<typeof AgentBrainSchema>;

export const AgentOutputSchema = z.object({
  current_state: AgentBrainSchema,
  action: z.array(z.record(z.record(z.any())))
});

export type AgentOutput = z.infer<typeof AgentOutputSchema>;

export class AgentHistory {
  model_output?: AgentOutput;
  result: ActionResult[];
  state: BrowserStateHistory;
  metadata?: StepMetadata;

  constructor(data: {
    model_output?: AgentOutput;
    result: ActionResult[];
    state: BrowserStateHistory;
    metadata?: StepMetadata;
  }) {
    this.model_output = data.model_output;
    this.result = data.result;
    this.state = data.state;
    this.metadata = data.metadata;
  }

  static get_interacted_element(
    model_output: AgentOutput,
    selector_map: SelectorMap
  ): (DOMHistoryElement | null)[] {
    const elements: (DOMHistoryElement | null)[] = [];

    for (const action of model_output.action) {
      const actionValue = Object.values(action)[0] as any; // Added type assertion
      const index = actionValue?.index;
      if (index != null && index in selector_map) {
        const el = selector_map[index];
        if (el) { // Added check for undefined el
          elements.push(HistoryTreeProcessor.convert_dom_element_to_history_element(el));
        } else {
          elements.push(null);
        }
      } else {
        elements.push(null);
      }
    }

    return elements;
  }

  toJSON(): Record<string, any> {
    // Custom serialization handling circular references
    let model_output_dump = null;

    if (this.model_output) {
      const action_dump = this.model_output.action.map(action => JSON.parse(JSON.stringify(action)));

      model_output_dump = {
        current_state: this.model_output.current_state,
        action: action_dump,
      };
    }

    return {
      model_output: model_output_dump,
      result: this.result.map(r => r),
      state: this.state.toJSON(),
      metadata: this.metadata,
    };
  }

  static fromSerializable(data: SerializableAgentHistoryItem, outputModel: z.ZodType<any>): AgentHistory {
    let model_output_parsed: AgentOutput | undefined = undefined;
    if (data.model_output) {
      // Ensure model_output is an object before parsing. It might be null.
      if (typeof data.model_output === 'object' && data.model_output !== null) {
        try {
          // Assuming AgentOutputSchema is the correct schema for model_output.current_state and model_output.action
          model_output_parsed = outputModel.parse(data.model_output) as AgentOutput;
        } catch (e) {
          console.error("Error parsing model_output during AgentHistory.fromSerializable:", e);
          // Decide how to handle parsing errors: throw, log, or set to undefined
          model_output_parsed = undefined; 
        }
      } else {
        // if data.model_output is not a suitable object, treat as undefined or handle as error
        model_output_parsed = undefined;
      }
    }

    // Reconstruct BrowserStateHistory - assuming it has a fromJSON or similar static method
    // For now, we'll pass the plain object. This might need adjustment if BrowserStateHistory needs specific reconstruction.
    const browserStateHistory = BrowserStateHistory.fromJSON(data.state as any); // Cast to any if fromJSON expects specific type not matching Record<string,any>

    return new AgentHistory({
      model_output: model_output_parsed,
      result: data.result as ActionResult[], // Assuming ActionResult needs no further processing
      state: browserStateHistory,
      metadata: data.metadata, // Assuming StepMetadata needs no further processing
    });
  }
}

export class AgentHistoryList {
  history: AgentHistory[];

  constructor(data: { history: AgentHistory[] }) {
    this.history = data.history;
  }

  total_duration_seconds(): number {
    let total = 0.0;
    for (const h of this.history) {
      if (h.metadata) {
        total += h.metadata.duration_seconds;
      }
    }
    return total;
  }

  total_input_tokens(): number {
    let total = 0;
    for (const h of this.history) {
      if (h.metadata) {
        total += h.metadata.input_tokens;
      }
    }
    return total;
  }

  input_token_usage(): number[] {
    return this.history
      .filter(h => h.metadata)
      .map(h => h.metadata!.input_tokens);
  }

  toString(): string {
    return `AgentHistoryList(all_results=${JSON.stringify(this.action_results())}, all_model_outputs=${JSON.stringify(this.model_actions())})`;
  }

  save_to_file(filepath: string): void {
    try {
      const dirPath = path.dirname(filepath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      const data = this.toJSON();
      fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      throw e;
    }
  }

  toJSON(): Record<string, any> {
    return {
      history: this.history.map(h => h.toJSON()),
    };
  }

  static load_from_file(filepath: string, outputModel: z.ZodType<any>): AgentHistoryList {
    const fileContent = fs.readFileSync(filepath, 'utf-8');
    const data = JSON.parse(fileContent) as SerializableAgentHistoryList; // Cast to ensure structure
    return AgentHistoryList.fromSerializable(data, outputModel);
  }

  static fromSerializable(data: SerializableAgentHistoryList, outputModel: z.ZodType<any>): AgentHistoryList {
    const historyItems = data.history.map((h_data: SerializableAgentHistoryItem) => AgentHistory.fromSerializable(h_data, outputModel));
    return new AgentHistoryList({ history: historyItems });
  }

  last_action(): Record<string, any> | null {
    const lastHistoryItem = this.history.length > 0 ? this.history[this.history.length - 1] : undefined;
    if (lastHistoryItem && lastHistoryItem.model_output && lastHistoryItem.model_output.action.length > 0) {
      const lastAction = lastHistoryItem.model_output.action[lastHistoryItem.model_output.action.length - 1];
      if (lastAction) { // Added check for undefined lastAction
        return JSON.parse(JSON.stringify(lastAction));
      }
    }
    return null;
  }

  errors(): (string | null)[] {
    const errors: (string | null)[] = [];

    for (const h of this.history) {
      if (h && h.result) { // Added check for undefined h and h.result
        const step_errors = h.result
          .filter(r => r && r.error) // Added check for undefined r
          .map(r => r.error) // Removed non-null assertion
          .filter(e => e !== undefined); // Filter out undefined errors

        // Each step can have only one error
        errors.push(step_errors.length > 0 && step_errors[0] !== undefined ? step_errors[0] : null); // Added check for undefined step_errors[0]
      } else {
        errors.push(null);
      }
    }

    return errors;
  }

  final_result(): string | null {
    const lastHistoryItem = this.history.length > 0 ? this.history[this.history.length - 1] : undefined;
    if (
      lastHistoryItem &&
      lastHistoryItem.result && // Added check for undefined result
      lastHistoryItem.result.length > 0
    ) {
      const lastResultItem = lastHistoryItem.result[lastHistoryItem.result.length - 1];
      if (lastResultItem && lastResultItem.extracted_content) { // Added check for undefined lastResultItem and extracted_content
        return lastResultItem.extracted_content;
      }
    }
    return null;
  }

  is_done(): boolean {
    const lastHistoryItem = this.history.length > 0 ? this.history[this.history.length - 1] : undefined;
    if (lastHistoryItem && lastHistoryItem.result && lastHistoryItem.result.length > 0) { // Added check for undefined result
      const lastResultItem = lastHistoryItem.result[lastHistoryItem.result.length - 1];
      return !!(lastResultItem && lastResultItem.is_done); // Added check for undefined lastResultItem
    }
    return false;
  }

  is_successful(): boolean | null {
    const lastHistoryItem = this.history.length > 0 ? this.history[this.history.length - 1] : undefined;
    if (lastHistoryItem && lastHistoryItem.result && lastHistoryItem.result.length > 0) { // Added check for undefined result
      const lastResultItem = lastHistoryItem.result[lastHistoryItem.result.length - 1];
      if (lastResultItem && lastResultItem.is_done) { // Added check for undefined lastResultItem
        return lastResultItem.success || false;
      }
    }
    return null;
  }

  has_errors(): boolean {
    return this.errors().some(error => error != null);
  }

  urls(): (string | null)[] {
    return this.history.map(h => h.state.url || null);
  }

  screenshots(): (string | null)[] {
    return this.history.map(h => h.state.screenshot || null);
  }

  action_names(): string[] {
    const action_names: string[] = [];

    for (const action of this.model_actions()) {
      if (action) { // Added check for undefined action
        const actions = Object.keys(action);
        if (actions.length > 0 && actions[0]) { // Added check for undefined actions[0]
          action_names.push(actions[0]);
        }
      }
    }

    return action_names;
  }

  model_thoughts(): AgentBrain[] {
    return this.history
      .filter(h => h.model_output)
      .map(h => h.model_output!.current_state);
  }

  model_outputs(): AgentOutput[] {
    return this.history
      .filter(h => h.model_output)
      .map(h => h.model_output!);
  }

  model_actions(): Record<string, any>[] {
    const outputs: Record<string, any>[] = [];

    for (const h of this.history) {
      if (h.model_output) {
        for (let i = 0; i < h.model_output.action.length; i++) {
          const action = h.model_output.action[i];
          const interacted_element = h.state.interacted_element ? h.state.interacted_element[i] : null;

          const output = JSON.parse(JSON.stringify(action));
          output.interacted_element = interacted_element;
          outputs.push(output);
        }
      }
    }

    return outputs;
  }

  action_results(): ActionResult[] {
    const results: ActionResult[] = [];

    for (const h of this.history) {
      results.push(...h.result.filter(r => r));
    }

    return results;
  }

  extracted_content(): string[] {
    const content: string[] = [];

    for (const h of this.history) {
      content.push(...h.result
        .filter(r => r.extracted_content)
        .map(r => r.extracted_content!)
      );
    }

    return content;
  }

  model_actions_filtered(include?: string[]): Record<string, any>[] {
    if (!include || include.length === 0) {
      include = [];
    }

    const outputs = this.model_actions();
    const result: Record<string, any>[] = [];

    for (const o of outputs) {
      for (const i of include) {
        if (i === Object.keys(o)[0]) {
          result.push(o);
        }
      }
    }

    return result;
  }

  number_of_steps(): number {
    return this.history.length;
  }
}

export class AgentError {
  static VALIDATION_ERROR = 'Invalid model output format. Please follow the correct schema.';
  static RATE_LIMIT_ERROR = 'Rate limit reached. Waiting before retry.';
  static NO_VALID_ACTION = 'No valid action found';
  static MAX_FAILURES_REACHED = 'Maximum number of failures reached';
  static AGENT_STOPPED = 'Agent was stopped';
  static AGENT_PAUSED = 'Agent was paused';

  message: string;
  error: Error;

  constructor(message: string, error?: Error) {
    this.message = message;
    this.error = error || new Error(message);
  }

  toString(): string {
    return this.message;
  }

  static fromError(error: Error): AgentError {
    if (error instanceof Error) {
      if (error.message.includes('validation')) {
        return new AgentError(AgentError.VALIDATION_ERROR, error);
      } else if (error.name === 'RateLimitError') {
        return new AgentError(AgentError.RATE_LIMIT_ERROR, error);
      }
    }
    return new AgentError(error.message, error);
  }
}

export interface AgentInterface {
  run(task: string, max_steps?: number): Promise<AgentHistoryList>;
  step(state: BrowserStateHistory): Promise<AgentOutput>;
  get_history(): AgentHistoryList;
}
