import { z } from 'zod';
import { ActionResult, AgentHistory, AgentHistoryList, AgentOutputSchema } from './views';
import { ManagedMessage, MessageManagerState as OriginalMessageManagerState, MessageHistory as OriginalMessageHistory } from './message_manager/views';

// Directly use ReturnType for types that have existing toJSON methods
export type SerializableManagedMessage = ReturnType<ManagedMessage['toJSON']>;
export type SerializableAgentHistoryItem = ReturnType<AgentHistory['toJSON']>;
export type SerializableAgentHistoryList = ReturnType<AgentHistoryList['toJSON']>;

// Define types for MessageHistory and MessageManagerState
export type SerializableMessageHistory = {
  messages: SerializableManagedMessage[];
  current_tokens: number;
};

export type SerializableMessageManagerState = {
  history: SerializableMessageHistory;
  tool_id: number;
};

// Define the main SerializableAgentState
export type SerializableAgentState = {
  agent_id: string;
  n_steps: number;
  consecutive_failures: number;
  last_result?: ActionResult[];
  history: SerializableAgentHistoryList;
  last_plan?: string;
  paused: boolean;
  stopped: boolean;
  message_manager_state: SerializableMessageManagerState;
};

// Schema for validating AgentOutput during deserialization, if needed directly
// This is already defined in views.ts, but re-exporting or referencing might be useful
export const DeserializationAgentOutputSchema = AgentOutputSchema;
export type DeserializationAgentOutput = z.infer<typeof DeserializationAgentOutputSchema>;
