
export interface BaseTelemetryEvent extends Record<string, any> {
  name: string;
}

export interface RegisteredFunction extends BaseTelemetryEvent {
  name: string;
  params: Record<string, any>;
}

export interface ControllerRegisteredFunctionsTelemetryEvent extends BaseTelemetryEvent {
  name: 'controller_registered_functions';
}

export interface AgentStepTelemetryEvent extends BaseTelemetryEvent {
  name: 'agent_step';
  agent_id: string;
  step: number;
  step_error: string[];
  consecutive_failures: number;
  actions: Record<string, any>[];
}

export interface AgentRunTelemetryEvent extends BaseTelemetryEvent {
  name: 'agent_run';
  agent_id: string;
  use_vision: boolean;
  task: string;
  model_name: string;
  chat_model_library: string;
  version: string;
  source: string;
}

export interface AgentEndTelemetryEvent extends BaseTelemetryEvent {
  name: 'agent_end';
  agent_id: string;
  steps: number;
  max_steps_reached: boolean;
  is_done: boolean;
  success: boolean | null;
  total_input_tokens: number;
  total_duration_seconds: number;
  errors: (string | null)[];
}
