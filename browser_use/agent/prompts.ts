import { BrowserState } from '../browser/views';
import { HumanMessage, SystemMessage } from '../models/langchain';
import { systemPromptTemplate } from './system_prompt';
import { ActionResult, AgentStepInfo } from './views';

export class SystemPrompt {
  private defaultActionDescription: string;
  private maxActionsPerStep: number;
  private systemMessage: SystemMessage;
  private promptTemplate: string = '';

  constructor(options: {
    actionDescription: string,
    maxActionsPerStep?: number,
    overrideSystemMessage?: string,
    extendSystemMessage?: string
  }) {
    this.defaultActionDescription = options.actionDescription;
    this.maxActionsPerStep = options.maxActionsPerStep || 10;
    let prompt = '';

    if (options.overrideSystemMessage) {
      prompt = options.overrideSystemMessage;
    } else {
      this.loadPromptTemplate();
      prompt = this.promptTemplate.replace('{max_actions}', this.maxActionsPerStep.toString());
    }

    if (options.extendSystemMessage) {
      prompt += `\n${options.extendSystemMessage}`;
    }

    this.systemMessage = new SystemMessage({ content: prompt });
  }

  private loadPromptTemplate(): void {
    try {
      this.promptTemplate = systemPromptTemplate;
    } catch (e) {
      throw new Error(`Failed to load system prompt template: ${e}`);
    }
  }

  public getSystemMessage(): SystemMessage {
    return this.systemMessage;
  }
}

export class AgentMessagePrompt {
  private state: BrowserState;
  private result?: ActionResult[];
  private includeAttributes: string[];
  private stepInfo?: AgentStepInfo;

  constructor(
    state: BrowserState,
    result?: ActionResult[],
    includeAttributes: string[] = [],
    stepInfo?: AgentStepInfo
  ) {
    this.state = state;
    this.result = result;
    this.includeAttributes = includeAttributes;
    this.stepInfo = stepInfo;
  }

  public getUserMessage(useVision: boolean = true): HumanMessage {
    const elementsText = this.state.element_tree.clickable_elements_to_string(this.includeAttributes);

    const hasContentAbove = (this.state.pixels_above || 0) > 0;
    const hasContentBelow = (this.state.pixels_below || 0) > 0;

    let formattedElementsText = '';
    if (elementsText !== '') {
      if (hasContentAbove) {
        formattedElementsText =
          `... ${this.state.pixels_above} pixels above - scroll or extract content to see more ...\n${elementsText}`;
      } else {
        formattedElementsText = `[Start of page]\n${elementsText}`;
      }

      if (hasContentBelow) {
        formattedElementsText +=
          `\n... ${this.state.pixels_below} pixels below - scroll or extract content to see more ...`;
      } else {
        formattedElementsText += '\n[End of page]';
      }
    } else {
      formattedElementsText = 'empty page';
    }

    let stepInfoDescription = '';
    if (this.stepInfo) {
      stepInfoDescription = `Current step: ${this.stepInfo.step_number + 1}/${this.stepInfo.max_steps}`;
    }
    const timeStr = new Date().toLocaleString();
    stepInfoDescription += ` Current date and time: ${timeStr}`;

    let stateDescription = `
[Task history memory ends]
[Current state starts here]
The following is one-time information - if you need to remember it write it to memory:
Current url: ${this.state.url}
Available tabs:
${this.state.tabs.map(tab => `TabInfo(page_id=${tab.page_id}, url=${tab.url}, title=${tab.title})`).join('\n')}
Interactive elements from top layer of the current page inside the viewport:
${formattedElementsText}
${stepInfoDescription}
`;

    if (this.result) {
      this.result.forEach((result, i) => {
        if (result.extracted_content) {
          stateDescription += `\nAction result ${i + 1}/${this.result!.length}: ${result.extracted_content}`;
        }
        if (result.error) {
          const error = result.error.split('\n').pop();
          stateDescription += `\nAction error ${i + 1}/${this.result!.length}: ...${error}`;
        }
      });
    }

    if (this.state.screenshot && useVision) {
      return new HumanMessage({
        content: [
          { type: 'text', text: stateDescription },
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${this.state.screenshot}` }
          }
        ]
      });
    }

    return new HumanMessage({ content: stateDescription });
  }
}

export class PlannerPrompt extends SystemPrompt {
  public getSystemMessage(): SystemMessage {
    return new SystemMessage({
      content: `You are a planning agent that helps break down tasks into smaller steps and reason about the current state.
Your role is to:
1. Analyze the current state and history
2. Evaluate progress towards the ultimate goal
3. Identify potential challenges or roadblocks
4. Suggest the next high-level steps to take

Inside your messages, there will be AI messages from different agents with different formats.

Your output format should be always a JSON object with the following fields:
{
    "state_analysis": "Brief analysis of the current state and what has been done so far",
    "progress_evaluation": "Evaluation of progress towards the ultimate goal (as percentage and description)",
    "challenges": "List any potential challenges or roadblocks",
    "next_steps": "List 2-3 concrete next steps to take",
    "reasoning": "Explain your reasoning for the suggested next steps"
}

Ignore the other AI messages output structures.

Keep your responses concise and focused on actionable insights.`
    });
  }
}