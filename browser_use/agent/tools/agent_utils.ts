import { Logger } from "../../utils";

const logger = new Logger("agent/utils");

export function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    function (c) {
      const r = (Math.random() * 16) | 0,
        v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }
  );
}

export function removeThinkTags(text: string): string {
  // Remove well-formatted <think>...</think> tags
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  // If there is an unmatched closing tag </think>, remove it and all preceding content
  text = text.replace(/.*?<\/think>/g, "");
  return text.trim();
}

export function excludeUnset(obj: any): any {
  const result: any = {};
  for (const key in obj) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

export function formatError(error: Error, includeTrace: boolean): string {
  if (includeTrace) {
    return `${error.name}: ${error.message}\n${error.stack}`;
  }
  return `${error.name}: ${error.message}`;
}
