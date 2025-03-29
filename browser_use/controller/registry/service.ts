import { BaseChatModel } from '../../models/langchain';
import { z } from 'zod';
import { BrowserContext } from '../../browser/context';
import { ProductTelemetry } from '../../telemetry/service';
import {
  ActionRegistry,
  RegisteredAction,
} from './views';
import { ActionResult } from "../../agent/views";
import { timeExecutionAsync } from '../../utils';

export interface ActionRunContext {
  browser: BrowserContext;
  page_extraction_llm?: BaseChatModel;
  sensitive_data?: Record<string, string>;
  context?: any;
  available_file_paths?: string[];
  has_sensitive_data?: boolean;
}

export class Registry<Context> {
  registry: ActionRegistry;
  private telemetry: ProductTelemetry;
  private exclude_actions: string[];

  constructor(exclude_actions: string[] = []) {
    this.registry = new ActionRegistry();
    this.telemetry = new ProductTelemetry();
    this.exclude_actions = exclude_actions;
  }

  action(args: {
    name: string,
    description: string,
    paramsSchema?: z.ZodObject<any>,
    func: (params: any, ctx: ActionRunContext) => ActionResult | Promise<ActionResult | void>;
  }) {
    if (this.exclude_actions.includes(args.name)) {
      return;
    }

    const actual_param_model = args.paramsSchema || z.object({});
    const action = new RegisteredAction(
      args.name,
      args.description,
      args.func,
      actual_param_model,
    );

    this.registry.actions[args.name] = action;
  }

  @timeExecutionAsync('--execute_action')
  async execute_action(
    action_name: string,
    params: Record<string, any>,
    options: {
      browser?: BrowserContext;
      page_extraction_llm?: BaseChatModel;
      sensitive_data?: Record<string, string>;
      available_file_paths?: string[];
      context?: Context;
    } = {}
  ): Promise<ActionResult> {
    if (!this.registry.actions[action_name]) {
      throw new Error(`Action ${action_name} not found`);
    }

    const action = this.registry.actions[action_name];
    try {
      const validated_params = action.paramsSchema.parse(params);
      if (options.sensitive_data) {
        this._replace_sensitive_data(validated_params, options.sensitive_data);
      }
      return await action.func(validated_params, options);
    } catch (e) {
      throw new Error(`Error executing action ${action_name}: ${e}`);
    }
  }

  private _replace_sensitive_data(params: any, sensitive_data: Record<string, string>): any {
    const secret_pattern = /<secret>(.*?)<\/secret>/g;

    const replace_secrets = (value: any): any => {
      if (typeof value === 'string') {
        return value.replace(secret_pattern, (_, placeholder) =>
          sensitive_data[placeholder] || placeholder
        );
      }
      if (Array.isArray(value)) {
        return value.map(replace_secrets);
      }
      if (typeof value === 'object' && value != null) {
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, replace_secrets(v)])
        );
      }
      return value;
    };

    Object.entries(params).forEach(([key, value]) => {
      params[key] = replace_secrets(value);
    });
    return params;
  }

  get_prompt_description(): string {
    return this.registry.get_prompt_description();
  }

  create_action_model(includeAction?: string[]): z.ZodType<any> {
    let actions = Object.values(this.registry.actions);
    if (includeAction?.length) {
      actions = actions.filter((action) => includeAction.includes(action.name));
    }
    const actionSchema = {};
    for (const action of actions) {
      actionSchema[action.name] = z.union([z.null(), action.paramsSchema], {
        description: action.description,
      }).optional();
    }
    const schema = z.object(actionSchema);
    return schema;
  }

}