import { z } from "zod";
import { ChatGroqAI } from "../browser_use/models/groq";
import {
  AIMessage,
  HumanMessage,
  StructuredTool,
  SystemMessage,
} from "../browser_use/models/langchain";

// Define parameter schema for our calculator tool
const CalculatorSchema = z.object({
  operation: z.enum(["add", "subtract", "multiply", "divide"]),
  a: z.coerce.number(), // Use coerce to handle string inputs from LLM
  b: z.coerce.number(), // Use coerce to handle string inputs from LLM
  // 'result' is an output of the calculation, not an input for the tool.
});

// Create a calculator tool
const calculatorTool = new StructuredTool({
  name: "calculator",
  description:
    "Perform basic arithmetic operations. Expects 'operation', 'a' (a number), and 'b' (a number).",
  schema: CalculatorSchema,
});

// Helper function to execute calculator operations
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
      throw new Error("Unknown operation:" + operation);
  }
}

// Initialize the LLM
const llm = new ChatGroqAI({
  modelName: "meta-llama/llama-4-scout-17b-16e-instruct", // Ensure this model supports function calling well
  apiKey: process.env.GROQ_API_KEY,
});

// Create a structured output handler
const structuredLLM = llm.withStructuredOutput(calculatorTool, {
  method: "auto",
});

// Example conversation
async function runCalculation() {
  const messages = [
    new SystemMessage({
      content:
        "You are a calculator assistant. " +
        "Use the calculator tool to perform calculations. " +
        "The tool expects 'operation' (add, subtract, multiply, divide), 'a' (a number), and 'b' (a number) as arguments. " +
        "Show your work step by step based on the tool's operations.",
    }),
    new HumanMessage({
      // Let the LLM determine the operation and numbers for the first step.
      // The original prompt "Calculate 25 + 17 and then multiply the result by 3" is a multi-step instruction.
      // We should break it down for the LLM or ensure it can handle multi-step tool use.
      // For this example, we'll guide it step-by-step.
      content: "What is twenty five plus seventeen?",
    }),
  ];

  try {
    console.log("Attempting first calculation: 25 + 17");
    const additionResponse = await structuredLLM.invoke(messages);

    if (!additionResponse.success) {
      console.error(
        "LLM failed to provide valid arguments for addition:",
        additionResponse.error,
        "Raw Args:",
        (additionResponse as any).rawArgs
      );
      throw new Error("Failed to perform addition due to invalid LLM output");
    }

    // `additionResponse` should now contain parsed `operation`, `a`, `b` if `success` is true.
    const sum = executeCalculation(
      additionResponse.data.operation,
      additionResponse.data.a,
      additionResponse.data.b
    );
    console.log("Addition response:", additionResponse.data);

    // Add the AI's response (simulating tool use confirmation) and the next human instruction
    messages.push(
      new AIMessage({
        content: `The result of ${additionResponse.data.a} ${additionResponse.data.operation} ${additionResponse.data.b} is ${sum}.`,
      })
    );
    let nextInstruction = `Multiply the result by total state in united states`;
    messages.push(
      new HumanMessage({
        content: nextInstruction,
      })
    );

    // Second calculation: multiply the sum by 3
    console.log(nextInstruction);
    const multiplyResponse = await structuredLLM.invoke(messages);

    console.log("Result ~>", multiplyResponse);
    // `multiplyResponse` should contain parsed `operation`, `a`, `b`.
    const finalResult = executeCalculation(
      multiplyResponse.data.operation,
      multiplyResponse.data.a,
      multiplyResponse.data.b
    );
    console.log(`Final result: ${finalResult}`);
  } catch (error) {
    console.error("Calculation process failed:", error);
  }
}

// Run the example
runCalculation().catch(console.error);
