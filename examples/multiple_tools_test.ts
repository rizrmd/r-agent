import { z } from "zod";
import { ChatGroqAI } from "../browser_use/models/groq";
import {
  AIMessage,
  HumanMessage,
  StructuredTool,
  SystemMessage,
} from "../browser_use/models/langchain";

// Define multiple tools
const CalculatorSchema = z.object({
  operation: z.enum(["add", "subtract", "multiply", "divide"]),
  a: z.coerce.number(),
  b: z.coerce.number(),
});

const WeatherSchema = z.object({
  location: z.string(),
  units: z.enum(["celsius", "fahrenheit"]).optional().default("celsius"),
});

const TimeSchema = z.object({
  timezone: z.string().optional().default("UTC"),
  format: z.enum(["12", "24"]).optional().default("24"),
});

// Create multiple tools
const calculatorTool = new StructuredTool({
  name: "calculator",
  description: "Perform basic arithmetic operations",
  schema: CalculatorSchema,
});

const weatherTool = new StructuredTool({
  name: "weather",
  description: "Get weather information for a location",
  schema: WeatherSchema,
});

const timeTool = new StructuredTool({
  name: "time",
  description: "Get current time for a timezone",
  schema: TimeSchema,
});

// Mock tool execution functions
function executeCalculation(operation: string, a: number, b: number): number {
  switch (operation) {
    case "add":
      return a + b;
    case "subtract":
      return a - b;
    case "multiply":
      return a * b;
    case "divide":
      if (b === 0) throw new Error("Division by zero");
      return a / b;
    default:
      throw new Error("Unknown operation: " + operation);
  }
}

function getWeather(location: string, units: string): string {
  return `Weather in ${location}: 22°${units === "celsius" ? "C" : "F"}, sunny`;
}

function getTime(timezone: string, format: string): string {
  const now = new Date();
  return `Current time in ${timezone}: ${now.toLocaleTimeString()}`;
}

// Initialize the LLM
const llm = new ChatGroqAI({
  modelName: "meta-llama/llama-4-scout-17b-16e-instruct",
  apiKey: process.env.GROQ_API_KEY,
});

async function testMultipleTools() {
  console.log("\n=== Testing Multiple Tools Usage ===");

  const multiToolLLM = llm.withTools([calculatorTool, weatherTool, timeTool], {
    tool_choice: "auto",
  });

  const messages = [
    new SystemMessage({
      content:
        "You are a helpful assistant with access to calculator, weather, and time tools. Use the appropriate tools to answer questions.",
    }),
    new HumanMessage({
      content:
        "Calculate 10 * 5, get weather for New York, and tell me the current time in UTC",
    }),
  ];

  try {
    const response = await multiToolLLM.invoke(messages);
    console.log("Multiple tools response:", JSON.stringify(response, null, 2));

    if (response.success && "toolCalls" in response && response.toolCalls) {
      console.log(
        `✓ Multiple tools test: received ${response.toolCalls.length} tool calls`
      );

      for (const toolCall of response.toolCalls) {
        console.log(
          `  - Tool: ${toolCall.toolName}, Success: ${toolCall.success}`
        );
        if (toolCall.success) {
          switch (toolCall.toolName) {
            case "calculator":
              const calcResult = executeCalculation(
                toolCall.data.operation,
                toolCall.data.a,
                toolCall.data.b
              );
              console.log(`    Calculator result: ${calcResult}`);
              break;
            case "weather":
              const weather = getWeather(
                toolCall.data.location,
                toolCall.data.units || "celsius"
              );
              console.log(`    Weather result: ${weather}`);
              break;
            case "time":
              const time = getTime(
                toolCall.data.timezone || "UTC",
                toolCall.data.format || "24"
              );
              console.log(`    Time result: ${time}`);
              break;
          }
        } else {
          console.error(`    Error in ${toolCall.toolName}:`, toolCall.error);
        }
      }
    } else {
      console.error("✗ Multiple tools test failed:", response.error);
    }
  } catch (error) {
    console.error("✗ Multiple tools test error:", error);
  }
}

async function testMixedScenarios() {
  console.log("\n=== Testing Edge Cases ===");

  // Test with array containing single tool (should work like single tool)
  const singleInArrayLLM = llm.withTools([calculatorTool], { tool_choice: "auto" });

  const messages = [
    new SystemMessage({
      content: "Use the calculator tool for arithmetic.",
    }),
    new HumanMessage({
      content: "What is 7 * 8?",
    }),
  ];

  try {
    const response = await singleInArrayLLM.invoke(messages);
    console.log("Single tool in array response:", response);

    if (response.success) {
      console.log("✓ Single tool in array test passed");
    } else {
      console.error("✗ Single tool in array test failed:", response.error);
    }
  } catch (error) {
    console.error("✗ Single tool in array test error:", error);
  }
}

// Run all tests
async function runTests() {
  console.log("Running Multiple Tools Tests...");

  await testMultipleTools();
  await testMixedScenarios();

  console.log("\n=== Tests Complete ===");
}

// Only run if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

export {
  testMultipleTools,
  testMixedScenarios,
  calculatorTool,
  weatherTool,
  timeTool,
};
