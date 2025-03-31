import { z } from 'zod';

export class RegisteredAction {
  constructor(
    public name: string,
    public description: string,
    public func: Function,
    public paramsSchema: z.ZodObject<any>
  ) { }

  prompt_description(): string {
    const skip_keys = ['title'];
    let s = `${this.description}: \n`;
    s += '{' + this.name + ': ';

    const schema = this.paramsSchema.shape;
    const properties = Object.entries(schema.properties || {}).reduce((acc, [k, v]) => {
      acc[k] = Object.entries(v as object).reduce((subAcc, [sub_k, sub_v]) => {
        if (!skip_keys.includes(sub_k)) {
          subAcc[sub_k] = sub_v;
        }
        return subAcc;
      }, {} as Record<string, any>);
      return acc;
    }, {} as Record<string, any>);

    s += JSON.stringify(properties);
    s += '}';
    return s;
  }
}

export const ActionModelSchema = z.record(z.record(z.any()));

export type ActionModel = z.infer<typeof ActionModelSchema>;

export function getActionIndex(action: Record<string, { index?: number }>): number | null {
  return Object.values(action)?.[0]?.index || null;
}

export function setActionIndex(action: Record<string, { index?: number }>, index: number): void {
  const act = Object.values(action)?.[0];
  if (act?.index != null) {
    act.index = index;
  }
}

export class ActionRegistry {
  actions: Record<string, RegisteredAction> = {};

  get_prompt_description(): string {
    return Object.values(this.actions)
      .map(action => action.prompt_description())
      .join('\n');
  }
}
