import * as fs from "fs";
import z from "zod";
import {
  ActionResult,
  AgentHistory,
  AgentHistoryList,
  AgentOutput,
  AgentSettings,
  AgentState,
  AgentStepInfo,
} from "../agent/views";
import { Browser } from "../browser/browser";
import { BrowserContext, BrowserContextConfig } from "../browser/context";
import { BrowserState, BrowserStateHistory } from "../browser/views";
import {
  ActionModel, // No longer a type import
  getActionIndex,
  setActionIndex,
} from "../controller/registry/views";
import { Controller } from "../controller/service";
import { HistoryTreeProcessor } from "../dom/history_tree_processor/service";
import { DOMHistoryElement } from "../dom/history_tree_processor/view";
import {
  BaseChatModel,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "../models/langchain";
import { ProductTelemetry } from "../telemetry/service";
import { Logger } from "../utils";
import { MessageManager } from "./message_manager/service";
import { AgentMessagePrompt, PlannerPrompt, SystemPrompt } from "./prompts";
import {
  convertAgentInputMessages,
  executeGetNextAction,
  executeMultiAct,
} from "./tools/agent_execution";
import {
  determineToolCallingMethod,
  setBrowserUseVersionAndSource,
  setModelNames,
  setupActionModels,
  ToolCallingMethod,
} from "./tools/agent_setup";
import {
  excludeUnset,
  formatError,
  generateUUID,
  removeThinkTags,
} from "./tools/agent_utils";

const logger = new Logger("agnt/service");

class BrowserAgent<Context extends unknown = any> {
  private task: string;
  private llm: BaseChatModel;
  private controller: Controller<Context>;
  private sensitiveData?: Record<string, string>;
  private settings: AgentSettings;
  private state: AgentState;
  private AgentOutput!: z.ZodType<any>; // Added !
  private DoneAgentOutput!: z.ZodType<any>; // Added !
  private availableActions: string;
  private toolCallingMethod: ToolCallingMethod;
  private messageManager: MessageManager;
  private injectedBrowser: boolean;
  private injectedBrowserContext: boolean;
  private browser?: Browser;
  private browserContext?: BrowserContext;
  private registerNewStepCallback?: (opt: {
    state: AgentState;
    browser: BrowserState;
    modelOutput: AgentOutput;
    step: number;
  }) => void | Promise<void>;
  private registerActionResultCallback?: (
    results: ActionResult[]
  ) => void | Promise<void>;
  private registerDoneCallback?: (
    history: AgentHistoryList
  ) => void | Promise<void>;
  private registerExternalAgentStatusRaiseErrorCallback?: () => void | Promise<boolean>;
  private context?: Context;
  private telemetry: ProductTelemetry;
  private version!: string;
  private source!: string;
  private chatModelLibrary!: string;
  private modelName!: string;
  private plannerModelName?: string;
  private initialActions?: Array<{ [k: string]: Record<string, any> }>;
  private initialLoadedNSteps?: number;

  constructor(
    task: string,
    llm: BaseChatModel,
    options: {
      browser?: Browser;
      browserContext?: BrowserContext;
      controller?: Controller<Context>;
      sensitiveData?: Record<string, string>;
      initialActions?: z.infer<typeof ActionModel>[]; // Use z.infer
      registerNewStepCallback?: (opt: {
        state: AgentState;
        browser: BrowserState;
        modelOutput: AgentOutput;
        step: number;
      }) => void | Promise<void>;
      registerActionResultCallback?: (
        results: ActionResult[]
      ) => void | Promise<void>;
      registerDoneCallback?: (
        history: AgentHistoryList
      ) => void | Promise<void>;
      registerExternalAgentStatusRaiseErrorCallback?: () => void | Promise<boolean>;
      useVision?: boolean;
      useVisionForPlanner?: boolean;
      saveConversationPath?: string;
      saveConversationPathEncoding?: string;
      maxFailures?: number;
      retryDelay?: number;
      overrideSystemMessage?: string;
      extendSystemMessage?: string;
      maxInputTokens?: number;
      validateOutput?: boolean;
      messageContext?: string;
      generateGif?: boolean | string;
      availableFilePaths?: string[];
      includeAttributes?: string[];
      maxActionsPerStep?: number;
      toolCallingMethod?: ToolCallingMethod;
      pageExtractionLLM?: BaseChatModel;
      plannerLLM?: BaseChatModel;
      plannerInterval?: number;
      injectedAgentState?: AgentState;
      context?: Context;
    } = {}
  ) {
    this.task = task;
    this.llm = llm;
    this.controller = options.controller || new Controller<Context>();
    this.sensitiveData = options.sensitiveData;

    // Initialize settings with defaults
    this.settings = new AgentSettings({
      use_vision: options.useVision ?? true,
      use_vision_for_planner: options.useVisionForPlanner ?? false,
      save_conversation_path: options.saveConversationPath,
      save_conversation_path_encoding:
        options.saveConversationPathEncoding ?? "utf-8",
      max_failures: options.maxFailures ?? 3,
      retry_delay: options.retryDelay ?? 10,
      override_system_message: options.overrideSystemMessage,
      extend_system_message: options.extendSystemMessage,
      max_input_tokens: options.maxInputTokens ?? 128000,
      validate_output: options.validateOutput ?? false,
      message_context: options.messageContext,
      generate_gif: options.generateGif ?? false,
      available_file_paths: options.availableFilePaths,
      include_attributes: options.includeAttributes ?? [
        "title",
        "type",
        "name",
        "role",
        "aria-label",
        "placeholder",
        "value",
        "alt",
        "aria-expanded",
        "data-date-format",
      ],
      max_actions_per_step: options.maxActionsPerStep ?? 10,
      tool_calling_method: options.toolCallingMethod ?? "auto",
      page_extraction_llm: options.pageExtractionLLM || this.llm,
      planner_llm: options.plannerLLM,
      planner_interval: options.plannerInterval ?? 1,
    });

    // Initialize state
    this.state =
      options.injectedAgentState ||
      new AgentState({
        n_steps: 0,
        last_result: [],
        consecutive_failures: 0,
        stopped: false,
        paused: false,
        agent_id: generateUUID(),
      });

    // Setup action models
    const { AgentOutput: ao, DoneAgentOutput: dao } = setupActionModels(
      this.controller
    );
    this.AgentOutput = ao;
    this.DoneAgentOutput = dao;

    const { version, source } = setBrowserUseVersionAndSource();
    this.version = version;
    this.source = source;

    this.initialActions = this.convertInitialActions(options.initialActions);

    // Model setup
    const { chatModelLibrary, modelName, plannerModelName } = setModelNames(
      this.llm,
      this.settings.planner_llm
    );
    this.chatModelLibrary = chatModelLibrary;
    this.modelName = modelName;
    this.plannerModelName = plannerModelName;

    this.availableActions = this.controller.registry.get_prompt_description();
    this.toolCallingMethod = determineToolCallingMethod(
      this.settings.tool_calling_method,
      this.modelName,
      this.chatModelLibrary
    );
    this.settings.message_context = this.setMessageContext();

    // Initialize message manager
    this.messageManager = new MessageManager({
      task,
      system_message: new SystemPrompt({
        actionDescription: this.availableActions,
        maxActionsPerStep: this.settings.max_actions_per_step,
        overrideSystemMessage: this.settings.override_system_message,
        extendSystemMessage: this.settings.extend_system_message,
      }).getSystemMessage(),
      settings: {
        max_input_tokens: this.settings.max_input_tokens,
        include_attributes: this.settings.include_attributes,
        message_context: this.settings.message_context,
        sensitive_data: this.sensitiveData,
        available_file_paths: this.settings.available_file_paths,
      },
      state: this.state.message_manager_state,
    });

    // Browser setup
    this.injectedBrowser = options.browser !== undefined;
    this.injectedBrowserContext = options.browserContext !== undefined;
    this.browser = options.browser;
    this.browserContext = options.browserContext;

    // Initialize browser if needed
    if (!this.browser && !this.browserContext) {
      // In a real implementation, you would initialize the browser here
      this.browser = new Browser();
      this.browserContext = new BrowserContext(this.browser);
    }

    if (this.browser && !this.browserContext) {
      // In a real implementation, you would create a browser context
      this.browserContext = new BrowserContext(
        this.browser,
        new BrowserContextConfig()
      );
    }

    // Callbacks
    this.registerNewStepCallback = options.registerNewStepCallback;
    this.registerActionResultCallback = options.registerActionResultCallback;
    this.registerDoneCallback = options.registerDoneCallback;
    this.registerExternalAgentStatusRaiseErrorCallback =
      options.registerExternalAgentStatusRaiseErrorCallback;

    // Context
    this.context = options.context;

    // Telemetry
    this.telemetry = new ProductTelemetry();

    if (options.injectedAgentState) {
      this.initialLoadedNSteps = options.injectedAgentState.n_steps;
    }

    if (this.settings.save_conversation_path) {
      logger.log(
        `Saving conversation to ${this.settings.save_conversation_path}`
      );
    }
  }

  // Helper methods
  private setMessageContext(): string | undefined {
    if (this.toolCallingMethod === "raw") {
      if (this.settings.message_context) {
        return `${this.settings.message_context}\n\nAvailable actions: ${this.availableActions}`;
      } else {
        return `Available actions: ${this.availableActions}`;
      }
    }
    return this.settings.message_context;
  }

  // Core functionality
  public addNewTask(newTask: string): void {
    this.messageManager.add_new_task(newTask);
  }

  private async raiseIfStoppedOrPaused(): Promise<void> {
    if (this.registerExternalAgentStatusRaiseErrorCallback) {
      if (await this.registerExternalAgentStatusRaiseErrorCallback()) {
        throw new Error("Interrupted");
      }
    }

    if (this.state.stopped || this.state.paused) {
      logger.log("Agent paused after getting state");
      throw new Error("Interrupted");
    }
  }

  // Main step function
  public async step(stepInfo?: AgentStepInfo): Promise<void> {
    logger.log(`📍 Step ${this.state.n_steps}`);
    let state = null;
    let modelOutput: AgentOutput | null = null;
    let result: ActionResult[] = [];
    const stepStartTime = Date.now();
    let tokens = 0;

    try {
      state = await this.browserContext?.get_state();

      await this.raiseIfStoppedOrPaused();

      if (state) {
        let previousBrainForPrompt: AgentOutput["current_state"] | undefined =
          undefined;
        if (
          this.initialLoadedNSteps !== undefined &&
          this.state.n_steps === this.initialLoadedNSteps &&
          this.state.history.history.length > 0
        ) {
          const lastHistoryItem =
            this.state.history.history[this.state.history.history.length - 1];
          if (lastHistoryItem?.model_output?.current_state) {
            previousBrainForPrompt = lastHistoryItem.model_output.current_state;
            logger.debug(
              `Resuming. Using previous brain for prompt: ${JSON.stringify(
                previousBrainForPrompt
              )}`
            );
          }
        }

        // Added null/undefined check for state
        this.messageManager.add_state_message(
          state,
          this.state.last_result,
          stepInfo,
          this.settings.use_vision,
          previousBrainForPrompt
        );
      } else {
        logger.warn(
          "Browser state is null or undefined, skipping add_state_message."
        );
        // Potentially throw an error or handle this case as critical
      }

      // Run planner at specified intervals if planner is configured
      if (
        this.settings.planner_llm &&
        this.state.n_steps % this.settings.planner_interval === 0
      ) {
        const plan = await this.runPlanner();
        this.messageManager.add_plan(plan || undefined, -1); // Changed plan to plan || undefined
      }

      if (stepInfo && stepInfo.is_last_step()) {
        // Add last step warning
        const msg =
          'Now comes your last step. Use only the "done" action now. No other actions - so here your action sequence must have length 1.\n' +
          'If the task is not yet fully finished as requested by the user, set success in "done" to false! E.g. if not all steps are fully completed.\n' +
          'If the task is fully finished, set success in "done" to true.\n' +
          "Include everything you found out for the ultimate task in the done text.";
        logger.log("Last step finishing up");
        this.messageManager.add_message_with_tokens({
          role: "user",
          content: msg,
        });
        this.AgentOutput = this.DoneAgentOutput;
      }

      const inputMessages = this.messageManager.get_messages();
      tokens = this.messageManager.state.history.current_tokens;

      try {
        modelOutput = await executeGetNextAction(
          this.llm,
          inputMessages,
          this.toolCallingMethod,
          // Use DoneAgentOutput if it's the last step, otherwise AgentOutput
          stepInfo && stepInfo.is_last_step()
            ? this.DoneAgentOutput
            : this.AgentOutput,
          this.modelName
        );
        this.state.n_steps += 1;

        if (this.registerNewStepCallback) {
          await this.registerNewStepCallback({
            state: this.state,
            browser: state!,
            modelOutput: modelOutput!,
            step: this.state.n_steps
          });
        }

        if (this.settings.save_conversation_path) {
          const target = `${this.settings.save_conversation_path}_${this.state.n_steps}.txt`;
          this.saveConversation(inputMessages, modelOutput, target);
        }

        this.messageManager.removeLastStateMessage();

        await this.raiseIfStoppedOrPaused();

        this.messageManager.add_model_output(modelOutput);
      } catch (error) {
        this.messageManager.removeLastStateMessage();
        throw error;
      }

      result = await executeMultiAct(
        modelOutput.action,
        true, // checkForNewElements
        this.browserContext!,
        this.controller,
        this.settings.page_extraction_llm as BaseChatModel, // Changed ! to as BaseChatModel
        this.raiseIfStoppedOrPaused.bind(this),
        this.browserContext?.config.wait_between_actions || 1000,
        this.sensitiveData,
        this.settings.available_file_paths,
        this.context
      );
      this.state.last_result = result;
      if (this.registerActionResultCallback) {
        await this.registerActionResultCallback(result);
      }

      const lastResultItem =
        result.length > 0 ? result[result.length - 1] : undefined;
      if (lastResultItem && lastResultItem.is_done) {
        // Added check for lastResultItem
        logger.log(`📄 Result: ${lastResultItem.extracted_content}`);
      }

      this.state.consecutive_failures = 0;
    } catch (error) {
      if ((error as Error).message === "Interrupted") {
        logger.log("Agent paused");
        this.state.last_result = [
          {
            error:
              "The agent was paused - now continuing actions might need to be repeated",
            include_in_memory: true,
            is_done: false,
          },
        ];
        return;
      } else {
        result = await this.handleStepError(error as Error);
        this.state.last_result = result;
      }
    } finally {
      const stepEndTime = Date.now();
      const actions = modelOutput
        ? modelOutput.action.map((a) => excludeUnset(a))
        : [];
      this.telemetry.capture({
        name: "agent_step",
        agentId: this.state.agent_id,
        step: this.state.n_steps,
        actions,
        consecutiveFailures: this.state.consecutive_failures,
        stepError: result
          ? result.filter((r) => r.error).map((r) => r.error)
          : ["No result"],
      });

      if (!result) {
        return;
      }

      if (state) {
        const metadata = {
          stepNumber: this.state.n_steps,
          stepStartTime,
          stepEndTime,
          inputTokens: tokens,
        };
        this.makeHistoryItem(modelOutput, state, result, metadata);
      }
    }
  }

  private async handleStepError(error: Error): Promise<ActionResult[]> {
    const includeTrace = true; // In real applications, this might depend on the log level
    let errorMsg = formatError(error, includeTrace);
    const prefix = `❌ Result failed ${this.state.consecutive_failures + 1}/${
      this.settings.max_failures
    } times:\n `;

    if (
      error instanceof Error &&
      (error.name === "ValidationError" || error.name === "ValueError")
    ) {
      logger.error(`${prefix}${errorMsg}`);

      if (errorMsg.includes("Max token limit reached")) {
        // Reduce the number of tokens in the history
        this.messageManager.settings.max_input_tokens =
          this.settings.max_input_tokens - 500;
        logger.log(
          `Cutting tokens from history - new max input tokens: ${this.messageManager.settings.max_input_tokens}`
        );
        this.messageManager.cut_messages();
      } else if (errorMsg.includes("Could not parse response")) {
        // Provide the model with a hint about what the output should look like
        errorMsg += "\n\nReturn a valid JSON object with the required fields.";
      }

      this.state.consecutive_failures += 1;
    } else {
      // Handle rate limit errors
      if (
        error.name === "RateLimitError" ||
        error.name === "ResourceExhausted"
      ) {
        logger.warn(`${prefix}${errorMsg}`);
        await new Promise((resolve) =>
          setTimeout(resolve, this.settings.retry_delay * 1000)
        );
        this.state.consecutive_failures += 1;
      } else {
        logger.error(`${prefix}${errorMsg}`);
        this.state.consecutive_failures += 1;
      }
    }

    return [
      {
        error: errorMsg,
        include_in_memory: true,
        is_done: false,
      },
    ];
  }

  private formatError(error: Error, includeTrace: boolean): string {
    if (includeTrace) {
      return `${error.name}: ${error.message}\n${error.stack}`;
    }
    return `${error.name}: ${error.message}`;
  }

  private makeHistoryItem(
    modelOutput: AgentOutput | null,
    state: BrowserState,
    result: ActionResult[],
    metadata?: any
  ): void {
    let interactedElements: (DOMHistoryElement | null)[];

    if (modelOutput) {
      interactedElements = AgentHistory.get_interacted_element(
        modelOutput,
        state.selector_map
      );
    } else {
      interactedElements = [];
    }

    const stateHistory = new BrowserStateHistory({
      url: state.url,
      title: state.title,
      tabs: state.tabs,
      interacted_element: interactedElements,
      screenshot: state.screenshot,
    });

    const historyItem = new AgentHistory({
      model_output: modelOutput || undefined, // Changed modelOutput to modelOutput || undefined
      result,
      state: stateHistory,
      metadata,
    });

    this.state.history.history.push(historyItem);
  }

  private logAgentRun(): void {
    logger.log(`🚀 Starting task: ${this.task}`);

    this.telemetry.capture({
      name: "agent_start",
      agentId: this.state.agent_id,
      useVision: this.settings.use_vision,
      task: this.task,
      modelName: this.modelName,
      chatModelLibrary: this.chatModelLibrary,
      version: this.version,
      source: this.source,
    });
  }

  public async takeStep(): Promise<[boolean, boolean]> {
    await this.step();

    if (this.state.history.is_done()) {
      if (this.settings.validate_output) {
        if (!(await this.validateOutput())) {
          return [true, false];
        }
      }

      await this.logCompletion();
      if (this.registerDoneCallback) {
        await this.registerDoneCallback(this.state.history);
      }

      return [true, true];
    }

    return [false, false];
  }

  public async run(maxSteps: number = 100): Promise<AgentHistoryList> {
    try {
      this.logAgentRun();

      // Execute initial actions if provided
      if (this.initialActions) {
        const result = await executeMultiAct(
          this.initialActions,
          false, // checkForNewElements
          this.browserContext!,
          this.controller,
          this.settings.page_extraction_llm as BaseChatModel, // Changed ! to as BaseChatModel
          this.raiseIfStoppedOrPaused.bind(this),
          this.browserContext?.config.wait_between_actions || 1000,
          this.sensitiveData,
          this.settings.available_file_paths,
          this.context
        );
        this.state.last_result = result;
      }

      for (let step = 0; step < maxSteps; step++) {
        // Check if stopped due to too many failures
        if (this.state.consecutive_failures >= this.settings.max_failures) {
          logger.error(
            `❌ Stopping due to ${this.settings.max_failures} consecutive failures`
          );
          break;
        }

        // Check control flags before each step
        if (this.state.stopped) {
          logger.log("Agent stopped");
          break;
        }

        while (this.state.paused) {
          await new Promise((resolve) => setTimeout(resolve, 200)); // Small delay to prevent CPU spinning
          if (this.state.stopped) {
            // Allow stopping while paused
            break;
          }
        }

        await this.step(new AgentStepInfo(step, maxSteps));

        if (this.state.history.is_done()) {
          if (this.settings.validate_output && step < maxSteps - 1) {
            if (!(await this.validateOutput())) {
              continue;
            }
          }

          await this.logCompletion();
          return this.state.history;
        }
      }

      logger.log("❌ Failed to complete task in maximum steps");
      return this.state.history;
    } finally {
      this.telemetry.capture({
        name: "agent_end",
        agentId: this.state.agent_id,
        isDone: this.state.history.is_done(),
        success: this.state.history.is_successful(),
        steps: this.state.n_steps,
        maxStepsReached: this.state.n_steps >= maxSteps,
        errors: this.state.history.errors(),
        totalInputTokens: this.state.history.total_input_tokens(),
        totalDurationSeconds: this.state.history.total_duration_seconds(),
      });

      if (!this.injectedBrowserContext && this.browserContext) {
        await this.browserContext.close();
      }

      if (!this.injectedBrowser && this.browser) {
        await this.browser.close();
      }

      if (this.settings.generate_gif) {
        let outputPath = "agent_history.gif";
        if (typeof this.settings.generate_gif === "string") {
          outputPath = this.settings.generate_gif;
        } // Removed extra brace here
        this.createHistoryGif(this.task, this.state.history, outputPath);
      }
    } // This is the end of the finally block
  } // This is the end of the run method

  private async validateOutput(): Promise<boolean> {
    const systemMsg =
      `You are a validator of an agent who interacts with a browser. ` +
      `Validate if the output of last action is what the user wanted and if the task is completed. ` +
      `If the task is unclear defined, you can let it pass. But if something is missing or the image does not show what was requested dont let it pass. ` +
      `Try to understand the page and help the model with suggestions like scroll, do x, ... to get the solution right. ` +
      `Task to validate: ${this.task}. Return a JSON object with 2 keys: is_valid and reason. ` +
      `is_valid is a boolean that indicates if the output is correct. ` +
      `reason is a string that explains why it is valid or not.` +
      ` example: {"is_valid": false, "reason": "The user wanted to search for "cat photos", but the agent searched for "dog photos" instead."}`;

    if (this.browserContext?.session) {
      const state = await this.browserContext.get_state();
      const content = new AgentMessagePrompt(
        state,
        this.state.last_result,
        this.settings.include_attributes
      );
      const messages = [
        new SystemMessage({ content: systemMsg }),
        content.getUserMessage(this.settings.use_vision),
      ];

      const ValidationResultSchema = z.object({
        is_valid: z.boolean(),
        reason: z.string(),
      });
      const validator = this.llm.withTools(
        {
          schema: ValidationResultSchema,
        },
        { includeRaw: false }
      );
      const validationResult = await validator.invoke(messages);

      if (
        !validationResult.success ||
        typeof validationResult.data === "undefined"
      ) {
        const errorDetail = validationResult.error
          ? validationResult.error instanceof Error
            ? validationResult.error.message
            : String(validationResult.error)
          : "Data is missing from validation response.";
        logger.error(
          `Validator invocation failed or data is missing: ${errorDetail}`
        );
        this.state.last_result = [
          {
            extracted_content: `Validation process could not be completed due to an issue with structuring the LLM's response. Details: ${errorDetail}`,
            include_in_memory: true,
            is_done: false,
          },
        ];
        return false;
      }

      const parsed = validationResult.data as z.infer<
        typeof ValidationResultSchema
      >;

      const isValid = parsed.is_valid;
      if (!isValid) {
        logger.log(`❌ Validator decision: ${parsed.reason}`);
        const msg = `The output is not yet correct. ${parsed.reason}.`;
        this.state.last_result = [
          {
            extracted_content: msg,
            include_in_memory: true,
            is_done: false,
          },
        ];
      } else {
        logger.log(`✅ Validator decision: ${parsed.reason}`);
      }
      return isValid;
    }

    // Without a browser session we cannot verify the output
    return true;
  }

  private async logCompletion(): Promise<void> {
    logger.log("✅ Task completed");
    if (this.state.history.is_successful()) {
      logger.log("✅ Successfully");
    } else {
      logger.log("❌ Unfinished");
    }

    if (this.registerDoneCallback) {
      await this.registerDoneCallback(this.state.history);
    }
  }

  private async runPlanner(): Promise<string | null> {
    // If plannerLlm is not set, skip planning
    if (!this.settings.planner_llm) {
      return null;
    }

    // Create planner message history using the full message history
    const plannerMessages = [
      this.getPlannerSystemMessage(),
      ...this.messageManager.get_messages().slice(1), // Use the full message history except the first one
    ];

    if (!this.settings.use_vision_for_planner && this.settings.use_vision) {
      const lastStateMessage =
        plannerMessages.length > 0
          ? plannerMessages[plannerMessages.length - 1]
          : undefined;
      if (lastStateMessage) {
        // Added check for lastStateMessage
        // Remove the image from the last state message
        let newMsg = "";
        if (
          lastStateMessage.content &&
          Array.isArray(lastStateMessage.content)
        ) {
          // Added check for lastStateMessage.content
          for (const msg of lastStateMessage.content) {
            if (msg.type === "text" && msg.text) {
              newMsg += msg.text;
            }
          }
        } else if (
          lastStateMessage.content &&
          typeof lastStateMessage.content === "string"
        ) {
          // Added check for lastStateMessage.content
          newMsg = lastStateMessage.content;
        }

        if (plannerMessages.length > 0) {
          // Ensure array is not empty before assignment
          plannerMessages[plannerMessages.length - 1] = new HumanMessage({
            content: newMsg,
          });
        }
      }
    }

    const convertedMessages = convertAgentInputMessages(
      plannerMessages,
      this.modelName
    );

    // Get planner output
    const response = await this.settings.planner_llm.invoke(convertedMessages);
    let plan = String(response.content);

    // If it is deepseek-reasoner, remove think tags
    if (
      this.plannerModelName &&
      (this.plannerModelName.includes("deepseek-r1") ||
        this.plannerModelName.includes("deepseek-reasoner"))
    ) {
      plan = removeThinkTags(plan);
    }

    try {
      const planJson = JSON.parse(plan);
      logger.log(`Planning Analysis:\n${JSON.stringify(planJson, null, 4)}`);
    } catch (e) {
      if (e instanceof SyntaxError) {
        logger.log(`Planning Analysis:\n${plan}`);
      } else {
        logger.debug(`Error parsing planning analysis: ${e}`);
        logger.log(`Plan: ${plan}`);
      }
    }

    return plan;
  }

  public async rerunHistory(
    history: AgentHistoryList,
    maxRetries: number = 3,
    skipFailures: boolean = true,
    delayBetweenActions: number = 2.0
  ): Promise<ActionResult[]> {
    // Execute initial actions if provided
    if (this.initialActions) {
      const result = await executeMultiAct(
        this.initialActions,
        true, // checkForNewElements, assuming true for initial setup if not specified
        this.browserContext!,
        this.controller,
        this.settings.page_extraction_llm as BaseChatModel, // Changed ! to as BaseChatModel
        this.raiseIfStoppedOrPaused.bind(this),
        this.browserContext?.config.wait_between_actions || 1000,
        this.sensitiveData,
        this.settings.available_file_paths,
        this.context
      );
      this.state.last_result = result;
      if (this.registerActionResultCallback) {
        await this.registerActionResultCallback(result);
      }
    }

    const results: ActionResult[] = [];

    for (let i = 0; i < history.history.length; i++) {
      const historyItem = history.history[i];
      if (!historyItem) {
        // Added check for undefined historyItem
        logger.warn(`History item at index ${i} is undefined, skipping.`);
        continue;
      }
      const goal = historyItem.model_output?.current_state?.next_goal || "";
      logger.log(
        `Replaying step ${i + 1}/${history.history.length}: goal: ${goal}`
      );

      if (
        !historyItem.model_output ||
        !historyItem.model_output.action ||
        historyItem.model_output.action[0] == null
      ) {
        logger.warn(`Step ${i + 1}: No action to replay, skipping`);
        results.push({
          error: "No action to replay",
          include_in_memory: true,
          is_done: false,
        });
        continue;
      }

      let retryCount = 0;
      while (retryCount < maxRetries) {
        try {
          const result = await this.executeHistoryStep(
            historyItem!,
            delayBetweenActions
          ); // Added non-null assertion
          results.push(...result);
          break;
        } catch (e) {
          retryCount++;
          if (retryCount === maxRetries) {
            const errorMsg = `Step ${
              i + 1
            } failed after ${maxRetries} attempts: ${e}`;
            logger.error(errorMsg);
            if (!skipFailures) {
              results.push({
                error: errorMsg,
                include_in_memory: true,
                is_done: false,
              });
              throw new Error(errorMsg);
            }
          } else {
            logger.warn(
              `Step ${
                i + 1
              } failed (attempt ${retryCount}/${maxRetries}), retrying...`
            );
            await new Promise((resolve) =>
              setTimeout(resolve, delayBetweenActions * 1000)
            );
          }
        }
      }
    }

    return results;
  }

  private async executeHistoryStep(
    historyItem: AgentHistory,
    delay: number
  ): Promise<ActionResult[]> {
    const state = await this.browserContext?.get_state();
    if (!state || !historyItem || !historyItem.model_output) {
      // Added check for undefined historyItem
      throw new Error("Invalid state or model output");
    }

    const updatedActions: z.infer<typeof ActionModel>[] = []; // Use z.infer
    for (let i = 0; i < historyItem.model_output.action.length; i++) {
      const actionToUpdate = historyItem.model_output.action[i];
      if (!actionToUpdate) {
        // Added check for undefined action
        logger.warn(
          `Action at index ${i} in history item is undefined, skipping update.`
        );
        continue;
      }
      const updatedAction = await this.updateActionIndices(
        historyItem.state.interacted_element[i],
        actionToUpdate,
        state
      );
      if (updatedAction) {
        // Ensure updatedAction is not null before pushing
        updatedActions.push(updatedAction);
      } else {
        throw new Error(`Could not find matching element ${i} in current page`);
      }
    }

    const result = await executeMultiAct(
      updatedActions,
      true, // Assuming true for checkForNewElements during rerun
      this.browserContext!,
      this.controller,
      this.settings.page_extraction_llm as BaseChatModel, // Changed ! to as BaseChatModel
      this.raiseIfStoppedOrPaused.bind(this),
      delay * 1000, // Pass delay directly
      this.sensitiveData,
      this.settings.available_file_paths,
      this.context
    );
    if (this.registerActionResultCallback) {
      await this.registerActionResultCallback(result);
    }
    await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    return result;
  }

  private async updateActionIndices(
    historicalElement: any,
    action: z.infer<typeof ActionModel>, // Use z.infer
    currentState: BrowserState
  ): Promise<any | null> {
    if (!historicalElement || !currentState.element_tree) {
      return action;
    }

    const currentElement = this.findHistoryElementInTree(
      historicalElement,
      currentState.element_tree
    );

    if (!currentElement || currentElement.highlightIndex == null) {
      return null;
    }

    const oldIndex = getActionIndex(action);
    if (oldIndex !== currentElement.highlightIndex) {
      setActionIndex(action, currentElement.highlightIndex);
      logger.log(
        `Element moved in DOM, updated index from ${oldIndex} to ${currentElement.highlightIndex}`
      );
    }

    return action;
  }

  private findHistoryElementInTree(
    historicalElement: any,
    elementTree: any
  ): any {
    // Here you need to implement the logic to find historical elements in the current element tree
    // This is a simplified implementation; a more complex matching algorithm may be needed in real applications
    return HistoryTreeProcessor.find_history_element_in_tree(
      historicalElement,
      elementTree
    );
  }

  public async loadAndRerun(
    historyFile?: string | any,
    options: any = {}
  ): Promise<ActionResult[]> {
    if (!historyFile) {
      historyFile = "AgentHistory.json";
    }

    const history = AgentHistoryList.load_from_file(
      historyFile,
      this.AgentOutput
    );
    return await this.rerunHistory(
      history,
      options.maxRetries,
      options.skipFailures,
      options.delayBetweenActions
    );
  }

  public saveHistory(filePath?: string | any): void {
    if (!filePath) {
      filePath = "AgentHistory.json";
    }

    const historyJson = JSON.stringify(this.state.history, null, 2);
    if (typeof filePath === "string") {
      fs.writeFileSync(filePath, historyJson);
    }
  }

  public pause(): void {
    logger.log("🔄 pausing Agent");
    this.state.paused = true;
  }

  public resume(): void {
    logger.log("▶️ Agent resuming");
    this.state.paused = false;
  }

  public stop(): void {
    logger.log("⏹️ Agent stopping");
    this.state.stopped = true;
  }

  private convertInitialActions(
    actions?: z.infer<typeof ActionModel>[] // Use z.infer
  ): z.infer<typeof ActionModel>[] | undefined {
    // Use z.infer
    // Added | undefined
    if (!actions) return undefined;

    const convertedActions = [];
    for (const actionDict of actions) {
      // Each actionDict should have one key-value pair
      const actionName = Object.keys(actionDict)[0] as string | undefined; // Added type assertion and undefined
      if (!actionName) {
        // Added check for undefined actionName
        logger.warn("Action name is undefined in initial actions, skipping.");
        continue;
      }
      const params = actionDict[actionName];

      // Get the parameter model for this action from the registry
      const actionInfo = this.controller.registry.registry.actions[actionName];
      if (!actionInfo) {
        // Added check for undefined actionInfo
        logger.warn(
          `Action info for "${actionName}" not found in registry, skipping.`
        );
        continue;
      }
      const paramModel = actionInfo.paramsSchema;

      // Create validated parameters using the appropriate parameter model
      const validatedParams = paramModel.parse(params);

      // Create an ActionModel instance using the validated parameters
      const actionModel = { [actionName]: validatedParams };
      convertedActions.push(actionModel);
    }

    return convertedActions;
  }

  private getPlannerSystemMessage(): SystemMessage {
    return new PlannerPrompt({
      actionDescription: this.controller.registry.get_prompt_description(),
    }).getSystemMessage();
  }

  private saveConversation(
    inputMessages: BaseMessage[],
    modelOutput: AgentOutput,
    target: string
  ): void {
    // Implement the logic to save the conversation
    const conversation = {
      inputMessages,
      modelOutput,
    };

    fs.writeFileSync(target, JSON.stringify(conversation, null, 2), {
      encoding: (this.settings.save_conversation_path as "utf-8") || "utf-8",
    });
  }

  private createHistoryGif(
    task: string,
    history: AgentHistoryList,
    outputPath: string
  ): void {
    throw new Error("Method not implemented.");
  }
}

// Export class
export { BrowserAgent as BrowserAgent };
