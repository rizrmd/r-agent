import z from "zod";
import { BaseChatModel, BaseMessage } from "../../models/langchain";
import { Logger } from "../../utils";
import { AgentOutput, ActionResult } from "../views";
import { ToolCallingMethod } from "./agent_setup";
import { removeThinkTags } from "./agent_utils";
import { convertInputMessages as convertInputMessagesUtil } from "../message_manager/utils";
import { Controller } from "../../controller/service";
import { BrowserContext } from "../../browser/context";
import { ActionModel, getActionIndex } from "../../controller/registry/views";

const logger = new Logger("agent/execution");

// Helper function moved from Agent class
export function convertAgentInputMessages( // Added export
  inputMessages: BaseMessage[],
  modelName: string
): BaseMessage[] {
  if (
    modelName === "deepseek-reasoner" ||
    modelName.includes("deepseek-r1") ||
    modelName.includes("deepseek-v3")
  ) {
    return convertInputMessagesUtil(inputMessages, modelName, true);
  } else {
    return inputMessages;
  }
}

function extractJsonFromModelOutput(content: string): any {
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch && jsonMatch[1]) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch (e) {
      logger.warn(
        `Failed to parse extracted JSON: ${jsonMatch[1]}, error: ${e}`
      );
      // Fall through to try parsing the whole content
    }
  }
  try {
    return JSON.parse(content);
  } catch (e) {
    logger.warn(`Failed to parse content as JSON: ${content}, error: ${e}`);
    throw new Error("Could not extract or parse JSON from model output");
  }
}

function createAgentOutputToolInternal(agentOutputSchema: z.ZodType<any>) {
  return {
    name: "AgentOutput",
    schema: agentOutputSchema,
    description: "AgentOutput model with custom actions",
  };
}

export async function executeGetNextAction(
  llm: BaseChatModel,
  inputMessages: BaseMessage[],
  toolCallingMethod: ToolCallingMethod,
  agentOutputSchema: z.ZodType<any>, // This is the specific AgentOutput or DoneAgentOutput schema
  modelName: string
): Promise<AgentOutput> {
  const processedMessages = convertAgentInputMessages(inputMessages, modelName);

  if (toolCallingMethod === "raw") {
    const output = await llm.invoke(processedMessages);
    const contentString = String(output.content);
    const cleanedContent = removeThinkTags(contentString);
    try {
      const parsedJson = extractJsonFromModelOutput(cleanedContent);
      return agentOutputSchema.parse(parsedJson) as AgentOutput;
    } catch (e) {
      logger.warn(
        `Failed to parse model output for raw method: ${cleanedContent}. Error: ${e}`
      );
      throw new Error(
        `Could not parse response for raw method. Content: ${cleanedContent}. Error: ${
          (e as Error).message
        }`
      );
    }
  } else if (toolCallingMethod == null) {
    const structuredLlm = llm.withTools(
      createAgentOutputToolInternal(agentOutputSchema),
      { includeRaw: true }
    );
    if (logger.isDebugEnabled()) {
      logger.debug("executeGetNextAction (null method)", processedMessages);
    }
    const response = await structuredLlm.invoke(processedMessages);
    const parsed = response.data;

    if (!response.success || !parsed) {
      throw new Error("Could not parse response (null method).");
    }
    return parsed as AgentOutput;
  } else {
    // function_calling or json_mode
    const structuredLlm = llm.withTools(
      createAgentOutputToolInternal(agentOutputSchema),
      {
        includeRaw: true,
        tool_choice: toolCallingMethod,
      }
    );
    if (logger.isDebugEnabled()) {
      logger.debug(
        `executeGetNextAction (${toolCallingMethod} method)`,
        processedMessages
      );
    }
    const response = await structuredLlm.invoke(processedMessages);
    const parsed = response.data;

    if (!response.success || !parsed) {
      throw new Error(
        `Could not parse response (${toolCallingMethod} method).`
      );
    }
    return parsed as AgentOutput;
  }
}

function isSubsetInternal(setA: Set<any>, setB: Set<any>): boolean {
  for (const elem of setA) {
    if (!setB.has(elem)) {
      return false;
    }
  }
  return true;
}

export async function executeMultiAct<C extends unknown = any>(
  actions: z.infer<typeof ActionModel>[] | undefined,
  checkForNewElements: boolean,
  browserContext: BrowserContext,
  controller: Controller<C>,
  pageExtractionLLM: BaseChatModel,
  raiseIfStoppedOrPausedFn: () => Promise<void>,
  waitBetweenActionsMs: number,
  sensitiveData?: Record<string, string>,
  availableFilePaths?: string[],
  agentContext?: C
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];

  if (!actions) {
    return results;
  }

  const cachedSelectorMap = await browserContext.get_selector_map();
  const cachedPathHashes = new Set(
    Array.from(Object.values(cachedSelectorMap || {})).map(
      (e) => e.hash.branch_path_hash
    )
  );

  await browserContext.remove_highlights();

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];

    if (action && getActionIndex(action) != null && i !== 0) {
      const newState = await browserContext.get_state();
      const newPathHashes = new Set(
        Array.from(Object.values(newState?.selector_map || {})).map(
          (e) => e.hash.branch_path_hash
        )
      );

      if (
        checkForNewElements &&
        !isSubsetInternal(newPathHashes, cachedPathHashes)
      ) {
        const msg = `Something new appeared after action ${i} / ${actions.length}`;
        logger.log(msg);
        results.push({
          extracted_content: msg,
          include_in_memory: true,
          is_done: false,
        });
        break;
      }
    }

    try {
      await raiseIfStoppedOrPausedFn();
    } catch (error) {
      // Assuming error means interrupted, so break the loop
      break;
    }

    if (!action) {
      logger.warn(`Action at index ${i} is undefined, skipping.`);
      continue;
    }

    const result = await controller.act(
      action,
      browserContext,
      pageExtractionLLM,
      sensitiveData,
      availableFilePaths,
      agentContext
    );

    results.push(result);
    logger.debug(`Executed action ${i + 1} / ${actions.length}`);

    const lastMultiActResult =
      results.length > 0 ? results[results.length - 1] : undefined;
    if (
      (lastMultiActResult &&
        (lastMultiActResult.is_done || lastMultiActResult.error)) ||
      i === actions.length - 1
    ) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, waitBetweenActionsMs));
  }
  return results;
}
