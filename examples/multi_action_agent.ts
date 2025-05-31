import { z } from "zod";
import { ChatGroqAI } from "../browser_use/models/groq";
import {
  AIMessage,
  HumanMessage,
  StructuredTool,
  SystemMessage,
} from "../browser_use/models/langchain";

// Schemas for individual assistant actions
const CheckEmailSchema = z.object({
  actionType: z.literal("checkEmail"),
  folder: z
    .string()
    .optional()
    .default("inbox")
    .describe("The email folder to check (e.g., 'inbox', 'spam', 'work')."),
  senderFilter: z
    .string()
    .optional()
    .describe("Filter emails by a specific sender."),
  unreadOnly: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to check only unread emails."),
  description: z
    .string()
    .optional()
    .describe("Description of this check email action."),
});

const SendEmailSchema = z.object({
  actionType: z.literal("sendEmail"),
  to: z.string().email().describe("The recipient's email address."),
  subject: z.string().describe("The subject of the email."),
  body: z.string().describe("The content of the email."),
  description: z
    .string()
    .optional()
    .describe("Description of this send email action."),
});

const BookCalendarSchema = z.object({
  actionType: z.literal("bookCalendar"),
  title: z.string().describe("The title of the calendar event."),
  startTime: z
    .string()
    .datetime()
    .describe("The start date and time for the event (ISO 8601 format)."),
  endTime: z
    .string()
    .datetime()
    .describe("The end date and time for the event (ISO 8601 format)."),
  participants: z
    .array(z.string().email())
    .optional()
    .describe("List of participant email addresses."),
  description: z
    .string()
    .optional()
    .describe("Description of this book calendar action."),
});

// Union schema for any possible single action
const SingleAssistantActionSchema = z.discriminatedUnion("actionType", [
  CheckEmailSchema,
  SendEmailSchema,
  BookCalendarSchema,
]);

// Create an assistant tool that can handle multiple actions
const assistantTool = new StructuredTool({
  name: "personalAssistant",
  description:
    "Performs a sequence of assistant tasks like checking email, sending email, or booking calendar events. " +
    "Expects an 'actions' array, where each action object has an 'actionType' ('checkEmail', 'sendEmail', 'bookCalendar') and corresponding parameters. " +
    "The tasks are performed in the order they appear in the array. " +
    "The LLM must determine the sequence of actions and their parameters based on the user's request. " +
    "For actions that might depend on previous ones (e.g., sending an email after checking for a reply), the LLM should structure the request logically, though the stubs here won't pass data between steps.",
  schema: z.object({
    actions: z
      .array(SingleAssistantActionSchema)
      .min(1)
      .describe("A list of assistant tasks to perform in sequence."),
  }),
});

// Stub functions for assistant actions
function checkEmailStub(params: z.infer<typeof CheckEmailSchema>): string {
  const logMessage =
    `Email Stub: Checking ${
      params.unreadOnly ? "unread" : "all"
    } emails in folder '${params.folder}'` +
    (params.senderFilter ? ` from sender '${params.senderFilter}'.` : ".");
  console.log(logMessage);
  // In a real scenario, this would return email data.
  return `Checked emails from ${params.folder}. Found 3 new emails.`;
}

function sendEmailStub(params: z.infer<typeof SendEmailSchema>): string {
  const logMessage = `Email Stub: Sending email to '${
    params.to
  }' with subject '${params.subject}'. Body: "${params.body.substring(
    0,
    50
  )}..."`;
  console.log(logMessage);
  return `Email successfully sent to ${params.to}.`;
}

function bookCalendarStub(params: z.infer<typeof BookCalendarSchema>): string {
  const logMessage =
    `Calendar Stub: Booking event '${params.title}' from ${params.startTime} to ${params.endTime}.` +
    (params.participants && params.participants.length > 0
      ? ` Participants: ${params.participants.join(", ")}.`
      : "");
  console.log(logMessage);
  return `Event '${params.title}' successfully booked.`;
}

// Initialize the LLM
const llm = new ChatGroqAI({
  modelName: "llama3-8b-8192",
  apiKey: process.env.GROQ_API_KEY,
});

// Create a structured output handler
const structuredLLM = llm.withTools(assistantTool, {
  tool_choice: "auto",
});

// Example conversation
async function runPersonalAssistantSimulation() {
  const messages = [
    new SystemMessage({
      content:
        "You are a helpful personal assistant. " +
        "Use the 'personalAssistant' tool to perform tasks requested by the user. " +
        "The tool expects an 'actions' array. Each item in the array is an object describing a single task. " +
        "Each action object must have an 'actionType' field, which can be 'checkEmail', 'sendEmail', or 'bookCalendar'. " +
        "Provide the necessary parameters for each actionType:\n" +
        "- checkEmail: { actionType: 'checkEmail', folder?: string, senderFilter?: string, unreadOnly?: boolean, description?: string }\n" +
        "- sendEmail: { actionType: 'sendEmail', to: string, subject: string, body: string, description?: string }\n" +
        "- bookCalendar: { actionType: 'bookCalendar', title: string, startTime: string (ISO 8601), endTime: string (ISO 8601), participants?: string[], description?: string }\n" +
        "Structure the actions in a logical sequence based on the user's request. " +
        "For example, if the user says 'Check my work emails for anything from Bob, then reply to him saying I got it, and then book a meeting with him for tomorrow at 2 PM for one hour titled Project Update'.\n" +
        "The actions array might look like:\n" +
        "[\n" +
        '  { "actionType": "checkEmail", "folder": "work", "senderFilter": "bob@example.com", "description": "Check work emails from Bob" },\n' +
        '  { "actionType": "sendEmail", "to": "bob@example.com", "subject": "Re: Your Email", "body": "Hi Bob, I got your email. Thanks!", "description": "Reply to Bob" },\n' +
        '  { "actionType": "bookCalendar", "title": "Project Update", "startTime": "[tomorrow\'s_date]T14:00:00Z", "endTime": "[tomorrow\'s_date]T15:00:00Z", "participants": ["bob@example.com"], "description": "Book meeting with Bob" }\n' +
        "]\n" +
        "Ensure all dateTimes are in ISO 8601 format (e.g., YYYY-MM-DDTHH:mm:ssZ). You will need to infer current date to correctly format future dates like 'tomorrow'. Assume today is 2025-05-15 for generating datetimes.",
    }),
    new HumanMessage({
      content:
        "Please check my main inbox for new emails. If there's an email from 'jane.doe@example.com' about 'Project Alpha', reply to her saying 'Got it, will review soon.' and then book a 30-minute meeting with her for tomorrow at 10 AM titled 'Project Alpha Sync'.",
    }),
  ];

  try {
    console.log(
      "User request:",
      (messages[messages.length - 1] as HumanMessage).content
    );
    console.log("\nAttempting personal assistant simulation with the LLM...");
    const response = await structuredLLM.invoke(messages);

    if (!response.success) {
      console.error(
        "LLM failed to provide valid arguments for the personalAssistant tool:",
        response.error
      );
      if ((response as any).rawArgs) {
        console.error("Raw arguments from LLM:", (response as any).rawArgs);
      }
      throw new Error(
        "Failed to perform assistant tasks due to invalid LLM output. Check logs for details."
      );
    }

    console.log(
      "\nLLM proposed actions:",
      JSON.stringify(response.data.actions, null, 2)
    );

    const actions = response.data.actions;
    if (!actions || actions.length === 0) {
      throw new Error("LLM did not provide any actions.");
    }

    console.log("\nExecuting assistant actions step-by-step:");
    let lastActionResult: any = null;

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      console.log(
        `\nStep ${i + 1}: ${
          action.description || `Executing ${action.actionType}`
        }`
      );

      switch (action.actionType) {
        case "checkEmail":
          lastActionResult = checkEmailStub(
            action as z.infer<typeof CheckEmailSchema>
          );
          break;
        case "sendEmail":
          // Example of simple chaining: LLM might be instructed to use info from 'lastActionResult'
          // For this stub, we're not actually using it, but showing where it could be.
          lastActionResult = sendEmailStub(
            action as z.infer<typeof SendEmailSchema>
          );
          break;
        case "bookCalendar":
          lastActionResult = bookCalendarStub(
            action as z.infer<typeof BookCalendarSchema>
          );
          break;
        default:
          console.error(
            `Error: Unknown action type at runtime: ${
              (action as any).actionType
            }`
          );
          throw new Error(`Unknown action type: ${(action as any).actionType}`);
      }
      console.log(`Result of Step ${i + 1}: ${lastActionResult}`);
    }

    console.log(`\nPersonal assistant simulation completed.`);
  } catch (error) {
    console.error("\nPersonal assistant simulation process failed:", error);
    if (error instanceof z.ZodError) {
      console.error(
        "Zod validation error details:",
        JSON.stringify(error.errors, null, 2)
      );
    }
  }
}

// Run the example
runPersonalAssistantSimulation().catch((error) => {
  // console.error("Unhandled error at the top level:", error);
});
