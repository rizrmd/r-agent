import { z } from "zod";
import { StructuredTool } from "../browser_use/models/langchain";

// Simple test without LLM to verify action execution
async function testToolActions() {
  console.log("=== Testing Tool Action Implementation ===");

  // Create a simple tool with action
  const testSchema = z.object({
    name: z.string(),
    value: z.number(),
  });

  const testTool = new StructuredTool({
    name: "test_tool",
    description: "A test tool with action",
    schema: testSchema,
    action: async (data) => {
      console.log(`Action executed with data:`, data);
      return {
        processed: true,
        originalData: data,
        timestamp: new Date().toISOString(),
        doubled: data.value * 2,
      };
    },
  });

  // Verify tool properties
  console.log("✓ Tool created successfully");
  console.log("  - Name:", testTool.name);
  console.log("  - Description:", testTool.description);
  console.log("  - Has action:", typeof testTool.action === "function");

  // Test action execution directly
  const testData = { name: "test", value: 42 };
  console.log("\\nTesting direct action execution...");
  
  if (testTool.action) {
    try {
      const result = await testTool.action(testData);
      console.log("✓ Action executed successfully");
      console.log("  - Input:", testData);
      console.log("  - Output:", result);
    } catch (error) {
      console.error("✗ Action execution failed:", error);
    }
  }

  // Test schema validation
  console.log("\\nTesting schema validation...");
  const validData = { name: "valid", value: 123 };
  const invalidData = { name: "invalid", value: "not-a-number" };

  const validResult = testTool.schema.safeParse(validData);
  const invalidResult = testTool.schema.safeParse(invalidData);

  console.log("✓ Valid data validation:", validResult.success ? "PASSED" : "FAILED");
  console.log("✓ Invalid data validation:", !invalidResult.success ? "PASSED" : "FAILED");

  console.log("\\n=== All Tests Completed ===");
}

// Run the test if this file is executed directly
if (require.main === module) {
  testToolActions().catch(console.error);
}

export { testToolActions };
