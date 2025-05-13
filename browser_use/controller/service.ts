import { BaseChatModel, HumanMessage } from "../models/langchain";
import * as markdownify from "../markdownify";
import { z } from "zod";
import { ActionResult } from "../agent/views";
import { BrowserContext } from "../browser/context";
import { Registry, ActionRunContext } from "./registry/service";
import {
  BaseAction,
  ClickElementAction,
  DoneAction,
  GoToUrlAction,
  InputTextAction,
  NoParamsAction,
  OpenTabAction,
  ScrollAction,
  SearchGoogleAction,
  SendKeysAction,
  SwitchTabAction,
} from "./views";
import { Logger } from "../utils";
import { join } from "path";
const logger = new Logger("controller/service");

export class Controller<Context> {
  registry: Registry<Context>;

  constructor(
    excludeActions: string[] = [],
    outputModel: z.infer<typeof BaseAction> = {}
  ) {
    this.registry = new Registry<Context>(excludeActions);

    // Register all default browser actions
    if (outputModel != null) {
      // Create a new model that extends the output model with success parameter
      const ExtendedOutputModel = z.object({
        success: z.boolean(),
        data: BaseAction,
      });

      this.registry.action({
        name: "done",
        paramsSchema: ExtendedOutputModel,
        description:
          "Complete task - with return text and if the task is finished (success=True) or not yet completly finished (success=False), because last step is reached",
        func: async (params: z.infer<typeof ExtendedOutputModel>) => {
          // Exclude success from the output JSON since it's an internal parameter
          const { success, ...outputDict } = params;
          return {
            is_done: true,
            success,
            extracted_content: JSON.stringify(outputDict),
          };
        },
      });
    } else {
      this.registry.action({
        name: "done",
        description:
          "Complete task - with return text and if the task is finished (success=True) or not yet completly finished (success=False), because last step is reached",
        paramsSchema: DoneAction,
        func: async (params: z.infer<typeof DoneAction>) => {
          return {
            is_done: true,
            success: params.success,
            extracted_content: params.text,
          };
        },
      });
    }

    // Basic Navigation Actions
    this.registry.action({
      name: "search_google",
      description:
        "Search the query in Google in the current tab, the query should be a search query like humans search in Google, concrete and not vague or super long. More the single most important items.",
      paramsSchema: SearchGoogleAction,
      func: async (
        params: z.infer<typeof SearchGoogleAction>,
        ctx: ActionRunContext
      ) => {
        const page = await ctx.browser.get_current_page();
        await page.goto(
          `https://www.google.com/search?q=${params.query}&udm=14`
        );
        await page.waitForLoadState();
        const msg = `🔍  Searched for "${params.query}" in Google`;
        logger.info(msg);
        return {
          extracted_content: msg,
          include_in_memory: true,
        };
      },
    });

    this.registry.action({
      name: "go_to_url",
      description: "Navigate to URL in the current tab",
      paramsSchema: GoToUrlAction,
      func: async (
        params: z.infer<typeof GoToUrlAction>,
        ctx: ActionRunContext
      ) => {
        const page = await ctx.browser.get_current_page();
        await page.goto(params.url);
        await page.waitForLoadState();
        const msg = `🔗  Navigated to ${params.url}`;
        logger.info(msg);
        return {
          extracted_content: msg,
          include_in_memory: true,
        };
      },
    });

    this.registry.action({
      name: "go_back",
      description: "Go back",
      func: async (
        params: z.infer<typeof NoParamsAction>,
        ctx: ActionRunContext
      ) => {
        await ctx.browser.go_back();
        const msg = "🔙  Navigated back";
        logger.info(msg);
        return {
          extracted_content: msg,
          include_in_memory: true,
        };
      },
    });

    // wait for x seconds
    this.registry.action({
      name: "wait",
      description: "Wait for x seconds default 3",
      paramsSchema: z.object({
        seconds: z.number().optional(),
      }),
      func: async (params: { seconds: number }) => {
        const seconds = params.seconds || 3;
        const msg = `🕒  Waiting for ${seconds} seconds`;
        logger.info(msg);
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        return {
          extracted_content: msg,
          include_in_memory: true,
        };
      },
    });

    // Element Interaction Actions
    this.registry.action({
      name: "click_element",
      description: "Click element",
      paramsSchema: ClickElementAction,
      func: async (
        params: z.infer<typeof ClickElementAction>,
        ctx: ActionRunContext
      ) => {
        const session = await ctx.browser.get_session();
        const selectorMap = await ctx.browser.get_selector_map();

        if (!(params.index in selectorMap)) {
          throw new Error(
            `Element with index ${params.index} does not exist - retry or use alternative actions`
          );
        }

        const elementNode = await ctx.browser.getDomElementByIndex(
          params.index
        );
        if (!elementNode) {
          // Added check for undefined elementNode
          throw new Error(
            `Element with index ${params.index} not found in DOM tree.`
          );
        }
        const initialPages = (await ctx.browser.session_get_pages(session))
          .length;

        // if element has file uploader then dont click
        if (await ctx.browser.is_file_uploader(elementNode)) {
          const msg = `Index ${params.index} - has an element which opens file upload dialog. To upload files please use a specific function to upload files`;
          logger.info(msg);
          return {
            extracted_content: msg,
            include_in_memory: true,
          };
        }

        let msg = null;

        try {
          const downloadPath = await ctx.browser.click_element_node(
            elementNode
          );
          if (downloadPath) {
            msg = `💾  Downloaded file to ${downloadPath}`;
          } else {
            msg = `🖱️  Clicked button with index ${
              params.index
            }: ${elementNode.get_all_text_till_next_clickable_element(2)}`;
          }

          logger.info(msg);
          logger.debug(`Element xpath: ${elementNode.xpath}`);
          const newPages = await ctx.browser.session_get_pages(session);
          if (newPages.length > initialPages) {
            const newTabMsg = "New tab opened - switching to it";
            msg += ` - ${newTabMsg}`;
            logger.info(newTabMsg);
            await ctx.browser.switch_to_tab(-1);
          }
          return {
            extracted_content: msg,
            include_in_memory: true,
          };
        } catch (e) {
          logger.warning(
            `Element not clickable with index ${params.index} - most likely the page changed`
          );
          return { error: String(e) };
        }
      },
    });

    this.registry.action({
      name: "input_text",
      description: "Input text into a input interactive element",
      paramsSchema: InputTextAction,
      func: async (
        params: z.infer<typeof InputTextAction>,
        ctx: ActionRunContext
      ) => {
        const selectorMap = await ctx.browser.get_selector_map();
        if (!(params.index in selectorMap)) {
          throw new Error(
            `Element index ${params.index} does not exist - retry or use alternative actions`
          );
        }

        const elementNode = await ctx.browser.getDomElementByIndex(
          params.index
        );
        if (!elementNode) {
          // Added check for undefined elementNode
          throw new Error(
            `Element with index ${params.index} not found in DOM tree.`
          );
        }
        await ctx.browser.input_text_element_node(elementNode, params.text);

        let msg = "";
        if (!ctx.has_sensitive_data) {
          msg = `⌨️  Input ${params.text} into index ${params.index}`;
        } else {
          msg = `⌨️  Input sensitive data into index ${params.index}`;
        }

        logger.info(msg);
        logger.debug(`Element xpath: ${elementNode.xpath}`);
        return {
          extracted_content: msg,
          include_in_memory: true,
        };
      },
    });

    // Tab Management Actions
    this.registry.action({
      name: "switch_tab",
      description: "Switch tab",
      paramsSchema: SwitchTabAction,
      func: async (
        params: z.infer<typeof SwitchTabAction>,
        ctx: ActionRunContext
      ) => {
        await ctx.browser.switch_to_tab(params.page_id);
        // Wait for tab to be ready
        const page = await ctx.browser.get_current_page();
        await page.waitForLoadState();
        const msg = `🔄  Switched to tab ${params.page_id}`;
        logger.info(msg);
        return {
          extracted_content: msg,
          include_in_memory: true,
        };
      },
    });

    this.registry.action({
      name: "open_tab",
      description: "Open url in new tab",
      paramsSchema: OpenTabAction,
      func: async (
        params: z.infer<typeof OpenTabAction>,
        ctx: ActionRunContext
      ) => {
        await ctx.browser.create_new_tab(params.url);
        const msg = `🔗  Opened new tab with ${params.url}`;
        logger.info(msg);
        return {
          extracted_content: msg,
          include_in_memory: true,
        };
      },
    });

    // Content Actions
    this.registry.action({
      name: "extract_content",
      description:
        "Extract page content to retrieve specific information from the page, e.g. all company names, a specifc description, all information about, links with companies in structured format or simply links",
      paramsSchema: z.object({
        goal: z.string(),
      }),
      func: async (
        goal: string | { goal: string },
        ctx: ActionRunContext<Context>
      ) => {
        const page = await ctx.browser.get_current_page();
        const pageContent = await page.textContent("body");

        const prompt =
          `Your task is to extract the content of the page. You will be given a page and a goal` +
          ` and you should extract all relevant information around this goal from the page. If the goal is vague, ` +
          `summarize the page. Respond in json format. Extraction goal: ${
            (goal as { goal: string }).goal || goal
          }, Page: ${pageContent}`;

        try {
          const output = await ctx.page_extraction_llm!.invoke([
            new HumanMessage({ content: prompt }),
          ]);
          const msg = `📄  Extracted from page:\n ${output.content}\n`;
          logger.info(msg);
          return {
            extracted_content: msg,
            include_in_memory: true,
          };
        } catch (e) {
          logger.debug(`Error extracting content: ${e}`);
          const msg = `📄  Extracted from page:\n ${pageContent}\n`;
          logger.info(msg);
          return { extracted_content: msg };
        }
      },
    });

    this.registry.action({
      name: "scroll_down",
      description:
        "Scroll down the page by pixel amount - if no amount is specified, scroll down one page",
      paramsSchema: ScrollAction,
      func: async (
        params: z.infer<typeof ScrollAction>,
        ctx: ActionRunContext
      ) => {
        const page = await ctx.browser.get_current_page();
        if (params.amount != null) {
          await page.evaluate(`window.scrollBy(0, ${params.amount});`);
        } else {
          await page.evaluate("window.scrollBy(0, window.innerHeight);");
        }

        const amount =
          params.amount != null ? `${params.amount} pixels` : "one page";
        const msg = `🔍  Scrolled down the page by ${amount}`;
        logger.info(msg);
        return {
          extracted_content: msg,
          include_in_memory: true,
        };
      },
    });

    // scroll up
    this.registry.action({
      name: "scroll_up",
      description:
        "Scroll up the page by pixel amount - if no amount is specified, scroll up one page",
      paramsSchema: ScrollAction,
      func: async (
        params: z.infer<typeof ScrollAction>,
        ctx: ActionRunContext
      ) => {
        const page = await ctx.browser.get_current_page();
        if (params.amount != null) {
          await page.evaluate(`window.scrollBy(0, -${params.amount});`);
        } else {
          await page.evaluate("window.scrollBy(0, -window.innerHeight);");
        }

        const amount =
          params.amount != null ? `${params.amount} pixels` : "one page";
        const msg = `🔍  Scrolled up the page by ${amount}`;
        logger.info(msg);
        return {
          extracted_content: msg,
          include_in_memory: true,
        };
      },
    });

    // send keys
    this.registry.action({
      name: "send_keys",
      description:
        "Send strings of special keys like Escape,Backspace, Insert, PageDown, Delete, Enter, Shortcuts such as `Control+o`, `Control+Shift+T` are supported as well. This gets used in keyboard.press.",
      paramsSchema: SendKeysAction,
      func: async (
        params: z.infer<typeof SendKeysAction>,
        ctx: ActionRunContext
      ) => {
        const page = await ctx.browser.get_current_page();

        try {
          await page.keyboard.press(params.keys);
        } catch (e) {
          if (String(e).includes("Unknown key")) {
            // loop over the keys and try to send each one
            for (const key of params.keys) {
              try {
                await page.keyboard.press(key);
              } catch (keyError) {
                logger.debug(`Error sending key ${key}: ${String(keyError)}`);
                throw keyError;
              }
            }
          } else {
            throw e;
          }
        }

        const msg = `⌨️  Sent keys: ${params.keys}`;
        logger.info(msg);
        return {
          extracted_content: msg,
          include_in_memory: true,
        };
      },
    });

    this.registry.action({
      name: "scroll_to_text",
      description:
        "If you dont find something which you want to interact with, scroll to it",
      paramsSchema: z.object({
        text: z.string(),
      }),
      func: async (params: { text: string }, ctx: ActionRunContext) => {
        const text = params.text;
        const page = await ctx.browser.get_current_page();
        try {
          // Try different locator strategies
          const locators = [
            page.getByText(text, { exact: false }),
            page.locator(`text=${text}`),
            page.locator(`//*[contains(text(), '${text}')]`),
          ];

          for (const locator of locators) {
            try {
              // First check if element exists and is visible
              if (
                (await locator.count()) > 0 &&
                (await locator.first().isVisible())
              ) {
                await locator.first().scrollIntoViewIfNeeded();
                await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for scroll to complete
                const msg = `🔍  Scrolled to text: ${text}`;
                logger.info(msg);
                return {
                  extracted_content: msg,
                  include_in_memory: true,
                };
              }
            } catch (e) {
              logger.debug(`Locator attempt failed: ${String(e)}`);
              continue;
            }
          }

          const msg = `Text '${text}' not found or not visible on page`;
          logger.info(msg);
          return {
            extracted_content: msg,
            include_in_memory: true,
          };
        } catch (e) {
          const msg = `Failed to scroll to text '${text}': ${String(e)}`;
          logger.error(msg);
          return {
            error: msg,
            include_in_memory: true,
          };
        }
      },
    });

    this.registry.action({
      name: "get_dropdown_options",
      description: "Get all options from a native dropdown",
      paramsSchema: z.object({
        index: z.number(),
      }),
      func: async (
        params: { index: number },
        ctx: ActionRunContext
      ): Promise<ActionResult> => {
        const page = await ctx.browser.get_current_page();
        const selectorMap = await ctx.browser.get_selector_map();
        const domElement = selectorMap[params.index];

        if (!domElement) {
          // Added check for undefined domElement
          const msg = `Element with index ${params.index} not found in selector map.`;
          logger.error(msg);
          return { error: msg, include_in_memory: true };
        }

        try {
          // Frame-aware approach since we know it works
          const allOptions: string[] = [];
          let frameIndex = 0;

          for (const frame of page.frames()) {
            try {
              const handler = await frame.evaluateHandle<any>(`
                (xpath) => {
                  const select = document.evaluate(xpath, document, null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                  if (!select) return null;

                  return {
                    options: Array.from(select.options).map(opt => ({
                      text: opt.text, //do not trim, because we are doing exact match in select_dropdown_option
                      value: opt.value,
                      index: opt.index
                    })),
                    id: select.id,
                    name: select.name
                  };
                }
              `);
              const options = await handler.evaluate<any>(
                (handler: any, args) => handler(args),
                [handler, domElement.xpath]
              );
              if (options) {
                logger.debug(`Found dropdown in frame ${frameIndex}`);
                logger.debug(
                  `Dropdown ID: ${options.id}, Name: ${options.name}`
                );

                const formattedOptions = [];
                for (const opt of options.options) {
                  // encoding ensures AI uses the exact string in select_dropdown_option
                  const encodedText = JSON.stringify(opt.text);
                  formattedOptions.push(`${opt.index}: text=${encodedText}`);
                }

                allOptions.push(...formattedOptions);
              }
            } catch (frameE) {
              logger.debug(
                `Frame ${frameIndex} evaluation failed: ${String(frameE)}`
              );
            }

            frameIndex++;
          }

          if (allOptions.length > 0) {
            const msg =
              allOptions.join("\n") +
              "\nUse the exact text string in select_dropdown_option";
            logger.info(msg);
            return {
              extracted_content: msg,
              include_in_memory: true,
            };
          } else {
            const msg = "No options found in any frame for dropdown";
            logger.info(msg);
            return {
              extracted_content: msg,
              include_in_memory: true,
            };
          }
        } catch (e) {
          logger.error(`Failed to get dropdown options: ${String(e)}`);
          const msg = `Error getting options: ${String(e)}`;
          logger.info(msg);
          return {
            extracted_content: msg,
            include_in_memory: true,
          };
        }
      },
    });

    this.registry.action({
      name: "select_dropdown_option",
      description:
        "Select dropdown option for interactive element index by the text of the option you want to select",
      paramsSchema: z.object({
        index: z.number(),
        text: z.string(),
      }),
      func: async (
        params: { index: number; text: string },
        ctx: ActionRunContext
      ): Promise<ActionResult> => {
        const index = params.index;
        const text = params.text;
        const page = await ctx.browser.get_current_page();
        const selectorMap = await ctx.browser.get_selector_map();
        const domElement = selectorMap[index];

        if (!domElement) {
          // Added check for undefined domElement
          const msg = `Element with index ${index} not found in selector map.`;
          logger.error(msg);
          return { error: msg, include_in_memory: true };
        }

        // Validate that we're working with a select element
        if (domElement.tag_name !== "select") {
          logger.error(
            `Element is not a select! Tag: ${
              domElement.tag_name
            }, Attributes: ${JSON.stringify(domElement.attributes)}`
          );
          const msg = `Cannot select option: Element with index ${index} is a ${domElement.tag_name}, not a select`;
          return {
            extracted_content: msg,
            include_in_memory: true,
          };
        }

        logger.debug(
          `Attempting to select '${text}' using xpath: ${domElement.xpath}`
        );
        logger.debug(
          `Element attributes: ${JSON.stringify(domElement.attributes)}`
        );
        logger.debug(`Element tag: ${domElement.tag_name}`);

        const xpath = "//" + domElement.xpath;

        try {
          let frameIndex = 0;
          for (const frame of page.frames()) {
            try {
              logger.debug(`Trying frame ${frameIndex} URL: ${frame.url}`);

              // First verify we can find the dropdown in this frame
              const findDropdownJs = `
                (xpath) => {
                  try {
                    const select = document.evaluate(xpath, document, null,
                      XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                    if (!select) return null;
                    if (select.tagName.toLowerCase() !== 'select') {
                      return {
                        error: \`Found element but it's a \${select.tagName}, not a SELECT\`,
                        found: false
                      };
                    }
                    return {
                      id: select.id,
                      name: select.name,
                      found: true,
                      tagName: select.tagName,
                      optionCount: select.options.length,
                      currentValue: select.value,
                      availableOptions: Array.from(select.options).map(o => o.text.trim())
                    };
                  } catch (e) {
                    return {error: e.toString(), found: false};
                  }
                }
              `;
              const handler = await frame.evaluateHandle<any>(findDropdownJs);
              const dropdownInfo = await handler.evaluate<any>(
                (handler, xpath) => handler(xpath),
                [handler, domElement.xpath]
              );

              if (dropdownInfo) {
                if (!dropdownInfo.found) {
                  logger.error(
                    `Frame ${frameIndex} error: ${dropdownInfo.error}`
                  );
                  continue;
                }

                logger.debug(
                  `Found dropdown in frame ${frameIndex}: ${JSON.stringify(
                    dropdownInfo
                  )}`
                );

                // "label" because we are selecting by text
                // nth(0) to disable error thrown by strict mode
                // timeout=1000 because we are already waiting for all network events, therefore ideally we don't need to wait a lot here (default 30s)
                const selectedOptionValues = await frame
                  .locator("//" + domElement.xpath)
                  .nth(0)
                  .selectOption({ label: text }, { timeout: 1000 });

                const msg = `selected option ${text} with value ${selectedOptionValues}`;
                logger.info(msg + ` in frame ${frameIndex}`);

                return {
                  extracted_content: msg,
                  include_in_memory: true,
                };
              }
            } catch (frameE) {
              logger.error(
                `Frame ${frameIndex} attempt failed: ${String(frameE)}`
              );
              logger.error(`Frame type: ${typeof frame}`);
              logger.error(`Frame URL: ${frame.url}`);
            }

            frameIndex++;
          }

          const msg = `Could not select option '${text}' in any frame`;
          logger.info(msg);
          return {
            extracted_content: msg,
            include_in_memory: true,
          };
        } catch (e) {
          const msg = `Selection failed: ${String(e)}`;
          logger.error(msg);
          return {
            error: msg,
            include_in_memory: true,
          };
        }
      },
    });
  }

  // Register ---------------------------------------------------------------

  action(args: {
    name: string;
    description: string;
    paramsSchema?: z.ZodObject<any>;
    func: (params: any, ctx: ActionRunContext) => any;
  }) {
    /**
     * Decorator for registering custom actions
     *
     * @param description: Describe the LLM what the function does (better description == better function calling)
     */
    return this.registry.action(args);
  }

  // Act --------------------------------------------------------------------

  async act(
    actionData: Record<string, any>,
    browserContext: BrowserContext,
    pageExtractionLlm: BaseChatModel | null = null,
    sensitiveData: Record<string, string> | null = null,
    availableFilePaths: string[] | null = null,
    context: Context | null = null
  ): Promise<ActionResult> {
    /**
     * Execute an action
     */
    try {
      for (const [actionName, params] of Object.entries(actionData)) {
        if (params != null) {
          const result = await this.registry.execute_action(
            actionName,
            params,
            {
              browser: browserContext,
              page_extraction_llm: pageExtractionLlm ?? undefined, // Handle null case
              sensitive_data: sensitiveData ?? undefined, // Handle null case
              available_file_paths: availableFilePaths ?? undefined, // Handle null case
              context: context ?? undefined, // Handle null case
            }
          );

          if (typeof result === "string") {
            return { extracted_content: result };
          } else if (result) {
            return result;
          } else {
            throw new Error(
              `Invalid action result type: ${typeof result} of ${result}`
            );
          }
        }
      }
      return {};
    } catch (e) {
      throw e;
    }
  }
}
