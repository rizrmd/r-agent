import { z } from "zod";
import { ChatGroqAI } from "../browser_use/models/groq";
import {
  AIMessage,
  HumanMessage,
  StructuredTool,
  SystemMessage,
} from "../browser_use/models/langchain";

// Define parameter schema for our file writer tool
const FileWriterSchema = z.object({
  filename: z.string().describe("The name of the file to write"),
  content: z.string().describe("The content to write to the file"),
});

// Define parameter schema for our calculator tool with action
const CalculatorSchema = z.object({
  operation: z.enum(["add", "subtract", "multiply", "divide"]),
  a: z.coerce.number(),
  b: z.coerce.number(),
});

// Create a file writer tool with action
const fileWriterTool = new StructuredTool({
  name: "file_writer",
  description: "Write content to a file. Takes filename and content as parameters.",
  schema: FileWriterSchema,
  action: async (data: z.infer<typeof FileWriterSchema>) => {
    // This action will be executed automatically when the tool is called
    console.log(`Writing to file: ${data.filename}`);
    console.log(`Content: ${data.content}`);
    
    // In a real implementation, you would write to an actual file
    // For this example, we'll just simulate the file writing
    const result = {
      success: true,
      filename: data.filename,
      bytesWritten: data.content.length,
      timestamp: new Date().toISOString(),
    };
    
    console.log(`File written successfully: ${JSON.stringify(result)}`);
    return result;
  },
});

// Create a calculator tool with action
const calculatorTool = new StructuredTool({
  name: "calculator",
  description: "Perform basic arithmetic operations. Expects 'operation', 'a', and 'b'.",
  schema: CalculatorSchema,
  action: async (data: z.infer<typeof CalculatorSchema>) => {
    // This action will be executed automatically when the tool is called
    console.log(`Performing calculation: ${data.a} ${data.operation} ${data.b}`);
    
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
      default:
        throw new Error(`Unknown operation: ${data.operation}`);
    }
    
    console.log(`Calculation result: ${result}`);
    return {
      operation: data.operation,
      operands: [data.a, data.b],
      result: result,
      timestamp: new Date().toISOString(),
    };
  },
});

// Initialize the LLM
const llm = new ChatGroqAI({
  modelName: "meta-llama/llama-4-scout-17b-16e-instruct",
  apiKey: process.env.GROQ_API_KEY,
});

async function demonstrateToolActions() {
  console.log("=== Single Tool with Action Demo ===");
  
  // Test single tool with action
  const singleToolLLM = llm.withTools([calculatorTool]);
  
  const response1 = await singleToolLLM.invoke([
    new SystemMessage({
      content: "You are a helpful calculator assistant. Use the calculator tool to perform calculations."
    }),
    new HumanMessage({
      content: "What is 15 multiplied by 8?"
    }),
  ]);
  
  console.log("Single tool response:", JSON.stringify(response1, null, 2));
  if (response1.success) {
    // For single tool, actionResult is directly on the response
    if ('actionResult' in response1 && response1.actionResult) {
      console.log("Action was executed! Result:", response1.actionResult);
    }
  }
  
  console.log("\n=== Multiple Tools with Actions Demo ===");
  
  // Test multiple tools with actions
  const multiToolLLM = llm.withTools([calculatorTool, fileWriterTool]);
  
  const response2 = await multiToolLLM.invoke([
    new SystemMessage({
      content: "You are a helpful assistant with access to a calculator and file writer. Use these tools as needed."
    }),
    new HumanMessage({
      content: "Calculate 25 + 17, then write the result to a file called 'result.txt'."
    }),
  ]);
  
  console.log("Multiple tools response:", JSON.stringify(response2, null, 2));
  if (response2.success && response2.toolCalls) {
    response2.toolCalls.forEach((toolCall, index) => {
      console.log(`Tool ${index + 1} (${toolCall.toolName}):`, {
        success: toolCall.success,
        data: toolCall.data,
        actionResult: toolCall.actionResult,
      });
    });
  }
}

// Run the demonstration
if (require.main === module) {
  demonstrateToolActions().catch(console.error);
}

export { fileWriterTool, calculatorTool, demonstrateToolActions };
