# StructuredTool Actions

The `StructuredTool` class now supports an optional `action` property that allows you to define custom functions that will be executed automatically when the LLM calls the tool.

## Basic Usage

```typescript
import { z } from "zod";
import { StructuredTool } from "./langchain";

// Define the schema for your tool
const CalculatorSchema = z.object({
  operation: z.enum(["add", "subtract", "multiply", "divide"]),
  a: z.number(),
  b: z.number(),
});

// Create a tool with an action
const calculatorTool = new StructuredTool({
  name: "calculator",
  description: "Perform basic arithmetic operations",
  schema: CalculatorSchema,
  action: async (data) => {
    // This function will be executed automatically when the LLM calls this tool
    console.log(`Performing: ${data.a} ${data.operation} ${data.b}`);
    
    let result: number;
    switch (data.operation) {
      case "add":
        result = data.a + data.b;
        break;
      case "subtract":
        result = data.a - data.b;
        break;
      case "multiply":
        result = data.a * data.b;
        break;
      case "divide":
        if (data.b === 0) throw new Error("Division by zero");
        result = data.a / data.b;
        break;
    }
    
    return {
      result,
      timestamp: new Date().toISOString()
    };
  }
});
```

## Action Function Signature

The action function receives the parsed and validated data from the LLM tool call:

```typescript
action?: (data: z.infer<YourSchema>) => Promise<any> | any
```

- **Input**: The parsed data that matches your Zod schema
- **Output**: Can return any value (sync or async)
- **Error Handling**: If the action throws an error, it will be captured and returned in the tool call result

## Using Tools with Actions

```typescript
import { ChatGroqAI } from "../groq";
import { HumanMessage, SystemMessage } from "../langchain";

const llm = new ChatGroqAI({
  modelName: "meta-llama/llama-4-scout-17b-16e-instruct",
  apiKey: process.env.GROQ_API_KEY,
});

// Use the tool with LLM
const toolLLM = llm.withTools([calculatorTool]);

const response = await toolLLM.invoke([
  new SystemMessage({ content: "You are a helpful calculator assistant." }),
  new HumanMessage({ content: "What is 15 * 8?" })
]);

// Access the action result
if (response.success && 'actionResult' in response) {
  console.log("Tool data:", response.data);
  console.log("Action result:", response.actionResult);
}
```

## Multiple Tools with Actions

You can use multiple tools with actions simultaneously:

```typescript
const multiToolLLM = llm.withTools([calculatorTool, fileWriterTool]);

const response = await multiToolLLM.invoke([
  new SystemMessage({ content: "Use the tools as needed." }),
  new HumanMessage({ content: "Calculate 25 + 17, then save the result to a file." })
]);

// Access results from multiple tools
if (response.success && response.toolCalls) {
  response.toolCalls.forEach((toolCall) => {
    console.log(`${toolCall.toolName}:`, {
      data: toolCall.data,
      actionResult: toolCall.actionResult,
      success: toolCall.success
    });
  });
}
```

## Response Types

### Single Tool Response (`StructuredToolInput`)
```typescript
{
  success: boolean;
  error?: Error | z.ZodError<any>;
  raw: OpenAIMessage;
  data?: z.infer<StructuredTool["schema"]>;
  actionResult?: any;  // Result from the action function
}
```

### Multiple Tools Response (`MultipleStructuredToolInput`)
```typescript
{
  success: boolean;
  error?: Error | z.ZodError<any>;
  raw: OpenAIMessage;
  data?: any[];
  toolCalls?: Array<{
    toolName: string;
    data: any;
    success: boolean;
    error?: Error | z.ZodError<any>;
    actionResult?: any;  // Result from the action function
  }>;
}
```

## Error Handling

If an action throws an error, the tool call will be marked as failed:

```typescript
const toolWithErrorHandling = new StructuredTool({
  name: "risky_operation",
  description: "An operation that might fail",
  schema: z.object({ input: z.string() }),
  action: async (data) => {
    if (data.input === "fail") {
      throw new Error("Operation failed!");
    }
    return { success: true, processed: data.input };
  }
});
```

The error will be captured and included in the response:

```typescript
const response = await toolLLM.invoke([...]);
if (!response.success) {
  console.error("Tool failed:", response.error);
}
```

## Best Practices

1. **Keep actions simple**: Actions should be focused on a single responsibility
2. **Handle errors gracefully**: Use try-catch blocks for operations that might fail
3. **Return meaningful data**: The action result can be used by subsequent tool calls
4. **Use async when needed**: Actions can be synchronous or asynchronous
5. **Validate inputs**: The Zod schema validates inputs before the action is called
6. **Log appropriately**: Add logging to understand tool execution flow

## Example: File Writer Tool

```typescript
const fileWriterTool = new StructuredTool({
  name: "file_writer",
  description: "Write content to a file",
  schema: z.object({
    filename: z.string(),
    content: z.string()
  }),
  action: async (data) => {
    const fs = require('fs').promises;
    
    try {
      await fs.writeFile(data.filename, data.content, 'utf8');
      const stats = await fs.stat(data.filename);
      
      return {
        success: true,
        filename: data.filename,
        bytesWritten: stats.size,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Failed to write file: ${error.message}`);
    }
  }
});
```
