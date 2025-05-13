import z from "zod";
import { Logger } from "../../utils";
import { AgentOutputSchema, AgentSettings } from "../views";
import { BaseChatModel } from "../../models/langchain";
import { Controller } from "../../controller/service";

const logger = new Logger("agent/setup");

export type ToolCallingMethod =
  | "auto"
  | "function_calling"
  | "json_mode"
  | "raw"
  | null
  | undefined;

export function setupActionModels(
  controller: Controller<any>
): { AgentOutput: z.ZodType<any>; DoneAgentOutput: z.ZodType<any> } {
  const AgentModel = controller.registry.create_action_model();
  const AgentOutput = z.object({
    current_state: AgentOutputSchema.shape.current_state,
    action: z.array(AgentModel, {
      description: "List of actions to execute",
    }),
  });
  const DoneActionModel = controller.registry.create_action_model(["done"]);
  const DoneAgentOutput = z.object({
    current_state: AgentOutputSchema.shape.current_state,
    action: z.array(DoneActionModel, {
      description: "List of actions to execute",
    }),
  });
  return { AgentOutput, DoneAgentOutput };
}

export function setBrowserUseVersionAndSource(): {
  version: string;
  source: string;
} {
  let version: string;
  let source: string;
  try {
    // Implementation would depend on how you want to track versions in TypeScript
    version = "1.0.0"; // Placeholder
    source = "npm"; // Placeholder
  } catch (error) {
    version = "unknown";
    source = "unknown";
  }
  logger.log(`Version: ${version}, Source: ${source}`);
  return { version, source };
}

export function setModelNames(
  llm: BaseChatModel,
  plannerLlm?: BaseChatModel
): {
  chatModelLibrary: string;
  modelName: string;
  plannerModelName?: string;
} {
  const chatModelLibrary = llm.constructor.name;
  let modelName = "Unknown";

  if ("model_name" in llm) {
    modelName = (llm as any).model_name || "Unknown"; // Type assertion for model_name
  }

  let plannerModelName: string | undefined = undefined;
  if (plannerLlm) {
    if ("model_name" in plannerLlm) {
      plannerModelName = (plannerLlm as any).model_name; // Type assertion for model_name
    } else {
      plannerModelName = "Unknown";
    }
  }
  return { chatModelLibrary, modelName, plannerModelName };
}

export function determineToolCallingMethod(
  settingsToolCallingMethod: ToolCallingMethod,
  modelName: string,
  chatModelLibrary: string
): ToolCallingMethod {
  if (settingsToolCallingMethod === "auto") {
    if (
      modelName.includes("deepseek-reasoner") ||
      modelName.includes("deepseek-r1") ||
      modelName.includes("deepseek-v3")
    ) {
      return "raw";
    } else if (
      chatModelLibrary === "ChatGoogleGenerativeAI" ||
      chatModelLibrary === "ChatGeminiAI"
    ) {
      return "function_calling"; // Use function_calling for Gemini as well
    } else if (
      chatModelLibrary === "ChatOpenAI" ||
      chatModelLibrary === "AzureChatOpenAI"
    ) {
      return "function_calling";
    } else {
      return null;
    }
  } else {
    return settingsToolCallingMethod;
  }
}
