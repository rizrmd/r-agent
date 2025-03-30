import * as fs from 'fs';
import { Browser } from '../browser/browser';
import { BrowserContext, BrowserContextConfig } from '../browser/context';
import { BrowserState, BrowserStateHistory } from '../browser/views';
import { Controller } from '../controller/service';
import { MessageManager } from './message_manager/service';
import { AgentState, AgentSettings, ActionResult, AgentOutput, AgentOutputSchema, AgentStepInfo, AgentHistoryList } from '../agent/views';
import { AgentHistory } from '../agent/views';
import { DOMHistoryElement } from '../dom/history_tree_processor/view';
import { HistoryTreeProcessor } from '../dom/history_tree_processor/service';
import { BaseChatModel, BaseMessage, HumanMessage, SystemMessage } from '../models/langchain';
import { PlannerPrompt, AgentMessagePrompt, SystemPrompt } from './prompts';
import { ProductTelemetry } from '../telemetry/service';
import z from 'zod';
import { ActionModel, getActionIndex, setActionIndex } from '../controller/registry/views';
import { Logger } from '../utils';
import { convertInputMessages } from './message_manager/utils';

const logger = new Logger('agent/service');

type ToolCallingMethod = 'auto' | 'function_calling' | 'json_mode' | 'raw' | null | undefined;

class Agent<Context> {
  private task: string;
  private llm: BaseChatModel;
  private controller: Controller;
  private sensitiveData?: Record<string, string>;
  private settings: AgentSettings;
  private state: AgentState;
  private AgentOutput: z.ZodType<any>;
  private DoneAgentOutput: z.ZodType<any>;
  private availableActions: string;
  private toolCallingMethod: ToolCallingMethod;
  private messageManager: MessageManager;
  private injectedBrowser: boolean;
  private injectedBrowserContext: boolean;
  private browser?: Browser;
  private browserContext?: BrowserContext;
  private registerNewStepCallback?: (state: BrowserState, modelOutput: AgentOutput, step: number) => void | Promise<void>;
  private registerActionResultCallback?: (results: ActionResult[]) => void | Promise<void>;
  private registerDoneCallback?: (history: AgentHistoryList) => void | Promise<void>;
  private registerExternalAgentStatusRaiseErrorCallback?: () => void | Promise<boolean>;
  private context?: Context;
  private telemetry: ProductTelemetry;
  private version!: string;
  private source!: string;
  private chatModelLibrary!: string;
  private modelName!: string;
  private plannerModelName?: string;
  private initialActions?: Array<{ [k: string]: Record<string, any> }>;

  constructor(
    task: string,
    llm: BaseChatModel,
    options: {
      browser?: Browser;
      browserContext?: BrowserContext;
      controller?: Controller;
      sensitiveData?: Record<string, string>;
      initialActions?: ActionModel[];
      registerNewStepCallback?: (state: BrowserState, modelOutput: AgentOutput, step: number) => void | Promise<void>;
      registerActionResultCallback?: (results: ActionResult[]) => void | Promise<void>;
      registerDoneCallback?: (history: AgentHistoryList) => void | Promise<void>;
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
    this.controller = options.controller || new Controller();
    this.sensitiveData = options.sensitiveData;

    // Initialize settings with defaults
    this.settings = new AgentSettings({
      use_vision: options.useVision ?? true,
      use_vision_for_planner: options.useVisionForPlanner ?? false,
      save_conversation_path: options.saveConversationPath,
      save_conversation_path_encoding: options.saveConversationPathEncoding ?? 'utf-8',
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
        'title', 'type', 'name', 'role', 'aria-label',
        'placeholder', 'value', 'alt', 'aria-expanded', 'data-date-format'
      ],
      max_actions_per_step: options.maxActionsPerStep ?? 10,
      tool_calling_method: options.toolCallingMethod ?? 'auto',
      page_extraction_llm: options.pageExtractionLLM || this.llm,
      planner_llm: options.plannerLLM,
      planner_interval: options.plannerInterval ?? 1,
    });


    // Initialize state
    this.state = options.injectedAgentState || new AgentState({
      n_steps: 0,
      last_result: [],
      consecutive_failures: 0,
      stopped: false,
      paused: false,
      agent_id: this.generateUUID(),
    });

    // Setup action models
    this.setupActionModels();
    this.setBrowserUseVersionAndSource();
    this.initialActions = this.convertInitialActions(options.initialActions);

    // Model setup
    this.setModelNames();
    this.availableActions = this.controller.registry.get_prompt_description();
    this.toolCallingMethod = this.setToolCallingMethod();
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
      this.browserContext = new BrowserContext(this.browser, new BrowserContextConfig());
    }

    // Callbacks
    this.registerNewStepCallback = options.registerNewStepCallback;
    this.registerActionResultCallback = options.registerActionResultCallback;
    this.registerDoneCallback = options.registerDoneCallback;
    this.registerExternalAgentStatusRaiseErrorCallback = options.registerExternalAgentStatusRaiseErrorCallback;

    // Context
    this.context = options.context;

    // Telemetry
    this.telemetry = new ProductTelemetry();

    if (this.settings.save_conversation_path) {
      logger.log(`Saving conversation to ${this.settings.save_conversation_path}`);
    }
  }

  // Helper methods
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  private setMessageContext(): string | undefined {
    if (this.toolCallingMethod === 'raw') {
      if (this.settings.message_context) {
        return `${this.settings.message_context}\n\nAvailable actions: ${this.availableActions}`;
      } else {
        return `Available actions: ${this.availableActions}`;
      }
    }
    return this.settings.message_context;
  }

  private setBrowserUseVersionAndSource(): void {
    try {
      // Implementation would depend on how you want to track versions in TypeScript
      this.version = '1.0.0'; // Placeholder
      this.source = 'npm';    // Placeholder
    } catch (error) {
      this.version = 'unknown';
      this.source = 'unknown';
    }
    logger.log(`Version: ${this.version}, Source: ${this.source}`);
  }

  private setModelNames(): void {
    this.chatModelLibrary = this.llm.constructor.name;
    this.modelName = 'Unknown';

    if ('model_name' in this.llm) {
      this.modelName = this.llm.model_name || 'Unknown';
    }

    if (this.settings.planner_llm) {
      if ('model_name' in this.settings.planner_llm) {
        this.plannerModelName = this.settings.planner_llm.model_name;
      } else {
        this.plannerModelName = 'Unknown';
      }
    }
  }

  private setupActionModels(): void {
    const AgentModel = this.controller.registry.create_action_model();
    this.AgentOutput = z.object({
      current_state: AgentOutputSchema.shape.current_state,
      action: z.array(AgentModel, {
        description: 'List of actions to execute',
      }),
    });
    const DoneActionModel = this.controller.registry.create_action_model(['done']);
    this.DoneAgentOutput = z.object({
      current_state: AgentOutputSchema.shape.current_state,
      action: z.array(DoneActionModel, {
        description: 'List of actions to execute',
      }),
    });
  }

  private setToolCallingMethod(): ToolCallingMethod {
    const toolCallingMethod = this.settings.tool_calling_method;
    if (toolCallingMethod === 'auto') {
      if (this.modelName.includes('deepseek-reasoner') || this.modelName.includes('deepseek-r1') || this.modelName.includes('deepseek-v3')) {
        return 'raw';
      } else if (this.chatModelLibrary === 'ChatGoogleGenerativeAI') {
        return null;
      } else if (this.chatModelLibrary === 'ChatOpenAI' || this.chatModelLibrary === 'AzureChatOpenAI') {
        return 'function_calling';
      } else {
        return null;
      }
    } else {
      return toolCallingMethod;
    }
  }

  // Core functionality
  public addNewTask(newTask: string): void {
    this.messageManager.add_new_task(newTask);
  }

  private async raiseIfStoppedOrPaused(): Promise<void> {
    if (this.registerExternalAgentStatusRaiseErrorCallback) {
      if (await this.registerExternalAgentStatusRaiseErrorCallback()) {
        throw new Error('Interrupted');
      }
    }

    if (this.state.stopped || this.state.paused) {
      logger.log('Agent paused after getting state');
      throw new Error('Interrupted');
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

      this.messageManager.add_state_message(state, this.state.last_result, stepInfo, this.settings.use_vision);

      // Run planner at specified intervals if planner is configured
      if (this.settings.planner_llm && this.state.n_steps % this.settings.planner_interval === 0) {
        const plan = await this.runPlanner();
        this.messageManager.add_plan(plan, -1);
      }

      if (stepInfo && stepInfo.is_last_step()) {
        // Add last step warning
        const msg = 'Now comes your last step. Use only the "done" action now. No other actions - so here your action sequence must have length 1.\n' +
          'If the task is not yet fully finished as requested by the user, set success in "done" to false! E.g. if not all steps are fully completed.\n' +
          'If the task is fully finished, set success in "done" to true.\n' +
          'Include everything you found out for the ultimate task in the done text.';
        logger.log('Last step finishing up');
        this.messageManager.add_message_with_tokens({ role: 'user', content: msg });
        this.AgentOutput = this.DoneAgentOutput;
      }

      const inputMessages = this.messageManager.get_messages();
      tokens = this.messageManager.state.history.current_tokens;

      try {
        modelOutput = await this.getNextAction(inputMessages);

        this.state.n_steps += 1;

        if (this.registerNewStepCallback) {
          await this.registerNewStepCallback(state!, modelOutput, this.state.n_steps);
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

      result = await this.multiAct(modelOutput.action);
      this.state.last_result = result;
      if (this.registerActionResultCallback) {
        await this.registerActionResultCallback(result);
      }

      if (result.length > 0 && result[result.length - 1].is_done) {
        logger.log(`📄 Result: ${result[result.length - 1].extracted_content}`);
      }

      this.state.consecutive_failures = 0;

    } catch (error) {
      if ((error as Error).message === 'Interrupted') {
        logger.log('Agent paused');
        this.state.last_result = [
          {
            error: 'The agent was paused - now continuing actions might need to be repeated',
            include_in_memory: true,
            is_done: false
          }
        ];
        return;
      } else {
        result = await this.handleStepError(error as Error);
        this.state.last_result = result;
      }
    } finally {
      const stepEndTime = Date.now();
      const actions = modelOutput ? modelOutput.action.map(a => this.excludeUnset(a)) : [];
      this.telemetry.capture({
        name: 'agent_step',
        agentId: this.state.agent_id,
        step: this.state.n_steps,
        actions,
        consecutiveFailures: this.state.consecutive_failures,
        stepError: result ? result.filter(r => r.error).map(r => r.error) : ['No result']
      });

      if (!result) {
        return;
      }

      if (state) {
        const metadata = {
          stepNumber: this.state.n_steps,
          stepStartTime,
          stepEndTime,
          inputTokens: tokens
        };
        this.makeHistoryItem(modelOutput, state, result, metadata);
      }
    }
  }

  private async handleStepError(error: Error): Promise<ActionResult[]> {
    const includeTrace = true; // 在实际应用中可能会根据日志级别决定
    let errorMsg = this.formatError(error, includeTrace);
    const prefix = `❌ Result failed ${this.state.consecutive_failures + 1}/${this.settings.max_failures} times:\n `;

    if (error instanceof Error && (error.name === 'ValidationError' || error.name === 'ValueError')) {
      logger.error(`${prefix}${errorMsg}`);

      if (errorMsg.includes('Max token limit reached')) {
        // 减少历史记录中的令牌数
        this.messageManager.settings.max_input_tokens = this.settings.max_input_tokens - 500;
        logger.log(`Cutting tokens from history - new max input tokens: ${this.messageManager.settings.max_input_tokens}`);
        this.messageManager.cut_messages();
      } else if (errorMsg.includes('Could not parse response')) {
        // 给模型提示输出应该是什么样子
        errorMsg += '\n\nReturn a valid JSON object with the required fields.';
      }

      this.state.consecutive_failures += 1;
    } else {
      // 处理速率限制错误
      if (error.name === 'RateLimitError' || error.name === 'ResourceExhausted') {
        logger.warn(`${prefix}${errorMsg}`);
        await new Promise(resolve => setTimeout(resolve, this.settings.retry_delay * 1000));
        this.state.consecutive_failures += 1;
      } else {
        logger.error(`${prefix}${errorMsg}`);
        this.state.consecutive_failures += 1;
      }
    }

    return [{
      error: errorMsg,
      include_in_memory: true,
      is_done: false
    }];
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
      interactedElements = AgentHistory.get_interacted_element(modelOutput, state.selector_map);
    } else {
      interactedElements = [];
    }

    const stateHistory = new BrowserStateHistory({
      url: state.url,
      title: state.title,
      tabs: state.tabs,
      interacted_element: interactedElements,
      screenshot: state.screenshot
    });

    const historyItem = new AgentHistory({
      model_output: modelOutput,
      result,
      state: stateHistory,
      metadata
    });

    this.state.history.history.push(historyItem);
  }

  private excludeUnset(obj: any): any {
    const result: any = {};
    for (const key in obj) {
      if (obj[key] !== undefined) {
        result[key] = obj[key];
      }
    }
    return result;
  }

  private removeThinkTags(text: string): string {
    // 移除格式良好的 <think>...</think> 标签
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '');
    // 如果有未匹配的结束标签 </think>，移除它及之前的所有内容
    text = text.replace(/.*?<\/think>/g, '');
    return text.trim();
  }

  private convertInputMessages(inputMessages: BaseMessage[]): BaseMessage[] {
    if (this.modelName === 'deepseek-reasoner' || this.modelName.includes('deepseek-r1') || this.modelName.includes('deepseek-v3')) {
      return convertInputMessages(inputMessages, this.modelName, true);
    } else {
      return inputMessages;
    }
  }

  private async getNextAction(inputMessages: BaseMessage[]): Promise<AgentOutput> {
    inputMessages = this.convertInputMessages(inputMessages);

    if (this.toolCallingMethod === 'raw') {
      const output = await this.llm.invoke(inputMessages);
      output.content = this.removeThinkTags(String(output.content));
      try {
        const parsedJson = this.extractJsonFromModelOutput(output.content);
        return this.AgentOutput.parse(parsedJson);
      } catch (e) {
        logger.warn(`Failed to parse model output: ${output} ${e}`);
        throw new Error('Could not parse response.');
      }
    } else if (this.toolCallingMethod == null) {
      const structuredLlm = this.llm.withStructuredOutput(this.createAgentOutputTool(), { includeRaw: true });
      if (logger.isDebugEnabled()) {
        logger.debug('getNextAction', inputMessages);
      }
      const response = await structuredLlm.invoke(inputMessages);
      const parsed = response.data;

      if (!response.success || !parsed) {
        throw new Error('Could not parse response.');
      }

      return parsed;
    } else {
      const structuredLlm = this.llm.withStructuredOutput(this.createAgentOutputTool(), {
        includeRaw: true,
        method: this.toolCallingMethod
      });
      const response = await structuredLlm.invoke(inputMessages);
      const parsed = response.data;

      if (!response.success || !parsed) {
        throw new Error('Could not parse response.');
      }

      return parsed;
    }
  }

  private extractJsonFromModelOutput(content: string): any {
    // 实现从模型输出中提取 JSON 的逻辑
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      return JSON.parse(jsonMatch[1]);
    }

    // 尝试直接解析整个内容
    try {
      return JSON.parse(content);
    } catch (e) {
      throw new Error('Could not extract JSON from model output');
    }
  }

  private logAgentRun(): void {
    logger.log(`🚀 Starting task: ${this.task}`);
    logger.debug(`Version: ${this.version}, Source: ${this.source}`);

    this.telemetry.capture({
      name: 'agent_start',
      agentId: this.state.agent_id,
      useVision: this.settings.use_vision,
      task: this.task,
      modelName: this.modelName,
      chatModelLibrary: this.chatModelLibrary,
      version: this.version,
      source: this.source
    });
  }

  public async takeStep(): Promise<[boolean, boolean]> {
    await this.step();

    if (this.state.history.is_done()) {
      if (this.settings.validate_output) {
        if (!await this.validateOutput()) {
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

      // 执行初始操作（如果提供）
      if (this.initialActions) {
        const result = await this.multiAct(this.initialActions, false);
        this.state.last_result = result;
      }

      for (let step = 0; step < maxSteps; step++) {
        // 检查是否因为太多失败而停止
        if (this.state.consecutive_failures >= this.settings.max_failures) {
          logger.error(`❌ Stopping due to ${this.settings.max_failures} consecutive failures`);
          break;
        }

        // 每一步前检查控制标志
        if (this.state.stopped) {
          logger.log('Agent stopped');
          break;
        }

        while (this.state.paused) {
          await new Promise(resolve => setTimeout(resolve, 200)); // 小延迟防止 CPU 空转
          if (this.state.stopped) { // 暂停时允许停止
            break;
          }
        }

        await this.step(new AgentStepInfo(step, maxSteps));

        if (this.state.history.is_done()) {
          if (this.settings.validate_output && step < maxSteps - 1) {
            if (!await this.validateOutput()) {
              continue;
            }
          }

          await this.logCompletion();
          return this.state.history;
        }
      }

      logger.log('❌ Failed to complete task in maximum steps');
      return this.state.history;
    }
    finally {
      this.telemetry.capture({
        name: 'agent_end',
        agentId: this.state.agent_id,
        isDone: this.state.history.is_done(),
        success: this.state.history.is_successful(),
        steps: this.state.n_steps,
        maxStepsReached: this.state.n_steps >= maxSteps,
        errors: this.state.history.errors(),
        totalInputTokens: this.state.history.total_input_tokens(),
        totalDurationSeconds: this.state.history.total_duration_seconds()
      });

      if (!this.injectedBrowserContext && this.browserContext) {
        await this.browserContext.close();
      }

      if (!this.injectedBrowser && this.browser) {
        await this.browser.close();
      }

      if (this.settings.generate_gif) {
        let outputPath = 'agent_history.gif';
        if (typeof this.settings.generate_gif === 'string') {
          outputPath = this.settings.generate_gif;
        }

        this.createHistoryGif(this.task, this.state.history, outputPath);
      }
    }
  }

  private async multiAct(
    actions: ActionModel[],
    checkForNewElements: boolean = true
  ): Promise<ActionResult[]> {
    const results: ActionResult[] = [];

    const cachedSelectorMap = await this.browserContext?.get_selector_map();
    const cachedPathHashes = new Set(
      Array.from(Object.values(cachedSelectorMap || {})).map(e => e.hash.branch_path_hash)
    );

    await this.browserContext?.remove_highlights();

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];

      if (getActionIndex(action) != null && i !== 0) {
        const newState = await this.browserContext?.get_state();
        const newPathHashes = new Set(
          Array.from(Object.values(newState?.selector_map || {})).map(e => e.hash.branch_path_hash)
        );

        if (checkForNewElements && !this.isSubset(newPathHashes, cachedPathHashes)) {
          // 下一个操作需要索引，但页面上有新元素
          const msg = `Something new appeared after action ${i} / ${actions.length}`;
          logger.log(msg);
          results.push({
            extracted_content: msg,
            include_in_memory: true,
            is_done: false
          });
          break;
        }
      }

      try {
        await this.raiseIfStoppedOrPaused();
      } catch (error) {
        break;
      }

      const result = await this.controller.act(
        action,
        this.browserContext,
        this.settings.page_extraction_llm,
        this.sensitiveData,
        this.settings.available_file_paths,
        this.context
      );

      results.push(result);

      logger.debug(`Executed action ${i + 1} / ${actions.length}`);
      if (results[results.length - 1].is_done ||
        results[results.length - 1].error ||
        i === actions.length - 1) {
        break;
      }

      await new Promise(resolve =>
        setTimeout(resolve, this.browserContext?.config.wait_between_actions || 1000)
      );
    }

    return results;
  }

  private isSubset(setA: Set<any>, setB: Set<any>): boolean {
    for (const elem of setA) {
      if (!setB.has(elem)) {
        return false;
      }
    }
    return true;
  }

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
        content.getUserMessage(this.settings.use_vision)
      ];

      const ValidationResultSchema = z.object({
        is_valid: z.boolean(),
        reason: z.string()
      });
      const validator = this.llm.withStructuredOutput({
        schema: ValidationResultSchema,
      }, { includeRaw: true });
      const response = await validator.invoke(messages);
      const parsed = response.parsed as z.infer<typeof ValidationResultSchema>;

      const isValid = parsed.is_valid;
      if (!isValid) {
        logger.log(`❌ Validator decision: ${parsed.reason}`);
        const msg = `The output is not yet correct. ${parsed.reason}.`;
        this.state.last_result = [{
          extracted_content: msg,
          include_in_memory: true,
          is_done: false
        }];
      } else {
        logger.log(`✅ Validator decision: ${parsed.reason}`);
      }
      return isValid;
    }

    // 如果没有浏览器会话，我们无法验证输出
    return true;
  }

  private async logCompletion(): Promise<void> {
    logger.log('✅ Task completed');
    if (this.state.history.is_successful()) {
      logger.log('✅ Successfully');
    } else {
      logger.log('❌ Unfinished');
    }

    if (this.registerDoneCallback) {
      await this.registerDoneCallback(this.state.history);
    }
  }

  private async runPlanner(): Promise<string | null> {
    // 如果没有设置 plannerLlm，跳过规划
    if (!this.settings.planner_llm) {
      return null;
    }

    // 使用完整的消息历史创建规划器消息历史
    const plannerMessages = [
      this.getPlannerSystemMessage(),
      ...this.messageManager.get_messages().slice(1) // 使用除第一条外的完整消息历史
    ];

    if (!this.settings.use_vision_for_planner && this.settings.use_vision) {
      const lastStateMessage = plannerMessages[plannerMessages.length - 1];
      // 从最后一条状态消息中移除图像
      let newMsg = '';
      if (Array.isArray(lastStateMessage.content)) {
        for (const msg of lastStateMessage.content) {
          if (msg.type === 'text') {
            newMsg += msg.text;
          }
        }
      } else {
        newMsg = lastStateMessage.content;
      }

      plannerMessages[plannerMessages.length - 1] = new HumanMessage({
        content: newMsg
      });
    }

    const convertedMessages = this.convertInputMessages(plannerMessages);

    // 获取规划器输出
    const response = await this.settings.planner_llm.invoke(convertedMessages);
    let plan = String(response.content);

    // 如果是 deepseek-reasoner，移除思考标签
    if (this.plannerModelName &&
      (this.plannerModelName.includes('deepseek-r1') ||
        this.plannerModelName.includes('deepseek-reasoner'))) {
      plan = this.removeThinkTags(plan);
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
    // 如果提供了初始操作，则执行
    if (this.initialActions) {
      const result = await this.multiAct(this.initialActions);
      this.state.last_result = result;
      if (this.registerActionResultCallback) {
        await this.registerActionResultCallback(result);
      }
    }

    const results: ActionResult[] = [];

    for (let i = 0; i < history.history.length; i++) {
      const historyItem = history.history[i];
      const goal = historyItem.model_output?.current_state?.next_goal || '';
      logger.log(`Replaying step ${i + 1}/${history.history.length}: goal: ${goal}`);

      if (!historyItem.model_output ||
        !historyItem.model_output.action ||
        historyItem.model_output.action[0] == null) {
        logger.warn(`Step ${i + 1}: No action to replay, skipping`);
        results.push({ error: 'No action to replay', include_in_memory: true, is_done: false });
        continue;
      }

      let retryCount = 0;
      while (retryCount < maxRetries) {
        try {
          const result = await this.executeHistoryStep(historyItem, delayBetweenActions);
          results.push(...result);
          break;
        } catch (e) {
          retryCount++;
          if (retryCount === maxRetries) {
            const errorMsg = `Step ${i + 1} failed after ${maxRetries} attempts: ${e}`;
            logger.error(errorMsg);
            if (!skipFailures) {
              results.push({ error: errorMsg, include_in_memory: true, is_done: false });
              throw new Error(errorMsg);
            }
          } else {
            logger.warn(`Step ${i + 1} failed (attempt ${retryCount}/${maxRetries}), retrying...`);
            await new Promise(resolve => setTimeout(resolve, delayBetweenActions * 1000));
          }
        }
      }
    }

    return results;
  }

  private async executeHistoryStep(historyItem: AgentHistory, delay: number): Promise<ActionResult[]> {
    const state = await this.browserContext?.get_state();
    if (!state || !historyItem.model_output) {
      throw new Error('Invalid state or model output');
    }

    const updatedActions: ActionModel[] = [];
    for (let i = 0; i < historyItem.model_output.action.length; i++) {
      const updatedAction = await this.updateActionIndices(
        historyItem.state.interacted_element[i],
        historyItem.model_output.action[i],
        state
      );
      updatedActions.push(updatedAction);

      if (updatedAction == null) {
        throw new Error(`Could not find matching element ${i} in current page`);
      }
    }

    const result = await this.multiAct(updatedActions);
    if (this.registerActionResultCallback) {
      await this.registerActionResultCallback(result);
    }
    await new Promise(resolve => setTimeout(resolve, delay * 1000));
    return result;
  }

  private async updateActionIndices(
    historicalElement: any,
    action: ActionModel,
    currentState: BrowserState
  ): Promise<any | null> {
    if (!historicalElement || !currentState.element_tree) {
      return action;
    }

    const currentElement = this.findHistoryElementInTree(historicalElement, currentState.element_tree);

    if (!currentElement || currentElement.highlightIndex == null) {
      return null;
    }

    const oldIndex = getActionIndex(action);
    if (oldIndex !== currentElement.highlightIndex) {
      setActionIndex(action, currentElement.highlightIndex);
      logger.log(`Element moved in DOM, updated index from ${oldIndex} to ${currentElement.highlightIndex}`);
    }

    return action;
  }

  private findHistoryElementInTree(historicalElement: any, elementTree: any): any {
    // 这里需要实现在当前元素树中查找历史元素的逻辑
    // 这是一个简化的实现，实际应用中可能需要更复杂的匹配算法
    return HistoryTreeProcessor.find_history_element_in_tree(historicalElement, elementTree);
  }

  public async loadAndRerun(historyFile?: string | any, options: any = {}): Promise<ActionResult[]> {
    if (!historyFile) {
      historyFile = 'AgentHistory.json';
    }

    const history = AgentHistoryList.load_from_file(historyFile, this.AgentOutput );
    return await this.rerunHistory(history, options.maxRetries, options.skipFailures, options.delayBetweenActions);
  }


  public saveHistory(filePath?: string | any): void {
    if (!filePath) {
      filePath = 'AgentHistory.json';
    }

    const historyJson = JSON.stringify(this.state.history, null, 2);
    if (typeof filePath === 'string') {
      fs.writeFileSync(filePath, historyJson);
    }
  }

  public pause(): void {
    logger.log('🔄 pausing Agent');
    this.state.paused = true;
  }

  public resume(): void {
    logger.log('▶️ Agent resuming');
    this.state.paused = false;
  }

  public stop(): void {
    logger.log('⏹️ Agent stopping');
    this.state.stopped = true;
  }

  private convertInitialActions(actions?: ActionModel[]): ActionModel[] {
    if (!actions) return undefined;

    const convertedActions = [];
    for (const actionDict of actions) {
      // 每个 actionDict 应该有一个键值对
      const actionName = Object.keys(actionDict)[0];
      const params = actionDict[actionName];

      // 从注册表中获取此操作的参数模型
      const actionInfo = this.controller.registry.registry.actions[actionName];
      const paramModel = actionInfo.paramsSchema;

      // 使用适当的参数模型创建验证参数
      const validatedParams = paramModel.parse(params);

      // 使用验证参数创建 ActionModel 实例
      const actionModel = { [actionName]: validatedParams };
      convertedActions.push(actionModel);
    }

    return convertedActions;
  }


  private getPlannerSystemMessage(): SystemMessage {
    return new PlannerPrompt({
      actionDescription: this.controller.registry.get_prompt_description()
    }).getSystemMessage();
  }

  private saveConversation(inputMessages: BaseMessage[], modelOutput: AgentOutput, target: string): void {
    // 实现保存对话的逻辑
    const conversation = {
      inputMessages,
      modelOutput
    };

    fs.writeFileSync(
      target,
      JSON.stringify(conversation, null, 2),
      { encoding: this.settings.save_conversation_path as 'utf-8' || 'utf-8' }
    );
  }

  private createAgentOutputTool() {
    return {
      name: 'AgentOutput',
      schema: this.AgentOutput,
      description: 'AgentOutput model with custom actions',
    }
  }

  private createHistoryGif(task: string, history: AgentHistoryList, outputPath: string): void {
    throw new Error('Method not implemented.');
  }
}

// 导出类
export { Agent };