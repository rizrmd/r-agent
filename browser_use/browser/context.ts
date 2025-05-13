/**
 * Playwright browser on steroids.
 */

import type { Browser as PlaywrightBrowser } from "playwright";
import type { BrowserContext as PlaywrightBrowserContext } from "playwright";
import type { ElementHandle, FrameLocator, Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

// Importing equivalent views and services
import {
  BrowserError,
  BrowserState,
  type TabInfo,
  URLNotAllowedError,
} from "./views";
import { DomService } from "../dom/service";
import { DOMElementNode, type SelectorMap } from "../dom/views";
import { timeExecutionAsync, timeExecutionSync } from "../utils";
import { Browser } from "./browser";
import { Logger } from "../utils";

export type { Browser } from "playwright";

const logger = new Logger("browser_context");

// TypeScript equivalent of TypedDict
interface BrowserContextWindowSize {
  width: number;
  height: number;
}

interface CDPTarget {
  /** Target description */
  description: string;
  /** DevTools frontend URL */
  devtoolsFrontendUrl: string;
  /** Target ID */
  id: string;
  /** Page title */
  title: string;
  /** Target type (page, iframe, background_page, service_worker, etc.) */
  type: string;
  /** Page URL */
  url: string;
  /** WebSocket debugger URL */
  webSocketDebuggerUrl: string;
}

// TypeScript equivalent of dataclass
class BrowserContextConfig {
  /**
   * Configuration for the BrowserContext.
   *
   * Default values:
   *     cookies_file: null
   *         Path to cookies file for persistence
   *
   *         disable_security: true
   *                 Disable browser security features
   *
   *     minimum_wait_page_load_time: 0.5
   *         Minimum time to wait before getting page state for LLM input
   *
   *         wait_for_network_idle_page_load_time: 1.0
   *                 Time to wait for network requests to finish before getting page state.
   *                 Lower values may result in incomplete page loads.
   *
   *     maximum_wait_page_load_time: 5.0
   *         Maximum time to wait for page load before proceeding anyway
   *
   *     wait_between_actions: 1.0
   *         Time to wait between multiple per step actions
   *
   *     browser_window_size: {
   *             'width': 1280,
   *             'height': 1100,
   *         }
   *         Default browser window size
   *
   *     no_viewport: false
   *         Disable viewport
   *
   *     save_recording_path: null
   *         Path to save video recordings
   *
   *     save_downloads_path: null
   *         Path to save downloads to
   *
   *     trace_path: null
   *         Path to save trace files. It will auto name the file with the TRACE_PATH/{context_id}.zip
   *
   *     locale: null
   *         Specify user locale, for example en-GB, de-DE, etc. Locale will affect navigator.language value, Accept-Language request header value as well as number and date formatting rules. If not provided, defaults to the system default locale.
   *
   *     user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.102 Safari/537.36'
   *         custom user agent to use.
   *
   *     highlight_elements: true
   *         Highlight elements in the DOM on the screen
   *
   *     viewport_expansion: 500
   *         Viewport expansion in pixels. This amount will increase the number of elements which are included in the state what the LLM will see. If set to -1, all elements will be included (this leads to high token usage). If set to 0, only the elements which are visible in the viewport will be included.
   *
   *     allowed_domains: null
   *         List of allowed domains that can be accessed. If null, all domains are allowed.
   *         Example: ['example.com', 'api.example.com']
   *
   *     include_dynamic_attributes: bool = true
   *         Include dynamic attributes in the CSS selector. If you want to reuse the css_selectors, it might be better to set this to false.
   */
  cookies_file: string | null = null;
  minimum_wait_page_load_time: number = 0.25;
  wait_for_network_idle_page_load_time: number = 0.5;
  maximum_wait_page_load_time: number = 5;
  wait_between_actions: number = 0.5;

  disable_security: boolean = true;

  browser_window_size: BrowserContextWindowSize = { width: 1280, height: 1100 };
  no_viewport: boolean | null = null;

  save_recording_path: string | null = null;
  save_downloads_path: string | null = null;
  trace_path: string | null = null;
  locale: string | null = null;
  user_agent: string =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.102 Safari/537.36";

  highlight_elements: boolean = true;
  viewport_expansion: number = 500;
  allowed_domains: string[] | null = null;
  include_dynamic_attributes: boolean = true;

  force_keep_context_alive: boolean = false;
  mode?: "chromium" | "electron" | "electron-view";
}

interface BrowserSession {
  context: PlaywrightBrowserContext;
  cached_state: BrowserState | null;
  mainPage?: Page;
}

interface BrowserContextState {
  /**
   * State of the browser context
   */
  target_id: string | null; // CDP target ID
}

class BrowserContext {
  context_id: string;
  config: BrowserContextConfig;
  browser: Browser; // Reference to the Browser class
  state: BrowserContextState;
  session: BrowserSession | null = null;
  current_state?: BrowserState;
  private _page_event_handler: ((page: Page) => Promise<void>) | null = null;

  constructor(
    browser: Browser,
    config: BrowserContextConfig = new BrowserContextConfig(),
    state: BrowserContextState | null = null
  ) {
    this.context_id = uuidv4();
    logger.debug(
      `Initializing new browser context with id: ${this.context_id}`
    );

    this.config = config;
    this.browser = browser;
    this.state = state || {
      target_id: null,
    };
    if (!this.config.mode) {
      this.config.mode = browser.config.mode;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    /**
     * Async disposable pattern (equivalent to __aexit__)
     */
    await this.close();
  }

  @timeExecutionAsync("--close")
  async close(): Promise<void> {
    /**
     * Close the browser instance
     */
    logger.debug("Closing browser context");

    try {
      if (this.session == null) {
        return;
      }

      // Then remove CDP protocol listeners
      if (this._page_event_handler && this.session.context) {
        try {
          // This actually sends a CDP command to unsubscribe
          this.session.context.removeListener("page", this._page_event_handler);
        } catch (e) {
          logger.debug(`Failed to remove CDP listener: ${e}`);
        }
        this._page_event_handler = null;
      }

      await this.save_cookies();

      if (this.config.trace_path) {
        try {
          await this.session.context.tracing.stop({
            path: path.join(this.config.trace_path, `${this.context_id}.zip`),
          });
        } catch (e) {
          logger.debug(`Failed to stop tracing: ${e}`);
        }
      }

      // This is crucial - it closes the CDP connection
      if (!this.config.force_keep_context_alive) {
        try {
          await this.session.context.close();
        } catch (e) {
          logger.debug(`Failed to close context: ${e}`);
        }
      }
    } finally {
      // Dereference everything
      this.session = null;
      this._page_event_handler = null;
    }
  }

  @timeExecutionAsync("--initialize_session")
  async initialize_session(): Promise<BrowserSession> {
    /**
     * Initialize the browser session
     */
    logger.debug("Initializing browser context");

    const playwright_browser = await this.browser.get_playwright_browser();
    const context = await this.create_context(playwright_browser);
    this.add_new_page_listener(context); // Ensures 'page' event listener is set up

    // Get or create a page to use
    const pages = context.pages();

    this.session = {
      context,
      cached_state: null,
    };

    let active_page: Page | null = null;
    if (this.browser.config.cdp_url) {
      if (this.config.mode === "electron-view") {
        if (!this.browser.config.electronWebviewContext) {
          throw new BrowserError(
            "electron-view mode not provide electronWebviewContext"
          );
        }
        await this.browser.config.electronWebviewContext.init(this.session);
      }

      // If we have a saved target ID, try to find and activate it
      if (this.state.target_id) {
        const targets = await this._get_cdp_targets(); // Assuming _get_cdp_targets returns CDPTarget[]
        for (const target of targets) {
          if (target.id === this.state.target_id) {
            // Changed from target["targetId"]
            // Find matching page by URL
            for (const page of pages) {
              if (page.url() === target.url) {
                // Changed from target["url"]
                active_page = page;
                break;
              }
            }
            break;
          }
        }
      }

      if (!active_page && this.config.mode === "electron-view") {
        if (!this.browser.config.electronWebviewContext) {
          // Added check
          throw new BrowserError(
            "electron-view mode requires electronWebviewContext but it's not available."
          );
        }
        const electronPages =
          await this.browser.config.electronWebviewContext.pages(this.session);
        if (electronPages.length > 0) {
          active_page = electronPages[0] ?? null; // Handle potential undefined from pages[0]
        } else {
          active_page =
            await this.browser.config.electronWebviewContext.newPage(
              this.session
            );
        }
      }
    }

    // If no target ID or couldn't find it, use existing page or create new
    if (!active_page) {
      if (pages.length > 0) {
        // Check if pages array is not empty
        active_page = await this.getActivePage(pages);
        logger.debug("Using existing page");
      } else {
        active_page = await context.newPage();
        logger.debug("Created new page");
      }

      // Get target ID for the active page
      if (this.browser.config.cdp_url && active_page) {
        // Added null check for active_page
        const targets = await this._get_cdp_targets();
        for (const target of targets) {
          if (target.url === active_page.url()) {
            // Changed from target["url"]
            this.state.target_id = target.id; // Changed from target["targetId"]
            break;
          }
        }
      }
    }

    // Bring page to front
    if (active_page) {
      // Added null check for active_page
      await active_page.bringToFront();
      await active_page.waitForLoadState("load");
    } else {
      // This path implies no page could be activated or created.
      // Depending on application logic, this might be an error state.
      logger.warn("No active page could be set during session initialization.");
      // Consider if throwing an error here is more appropriate if an active page is mandatory.
    }

    return this.session;
  }

  async getActivePage(pages: Page[]): Promise<Page> {
    if (pages.length === 0) {
      // Throw an error if no pages are provided, as the method promises to return a Page.
      throw new Error("getActivePage called with an empty list of pages.");
    }
    for (const page of pages) {
      // Check if this page is the active one
      const isVisible = await page.evaluate(
        () => document.visibilityState === "visible" // TS error: document. Handled by tsconfig.json#lib: ["DOM"]
      );
      if (isVisible) {
        return page;
      }
    }
    // Fallback to the last page if no page is 'visible'.
    // Non-null assertion `!` is safe due to the `pages.length === 0` check.
    return pages[pages.length - 1]!;
  }

  add_new_page_listener(context: PlaywrightBrowserContext): void {
    const on_page = async (page: Page): Promise<void> => {
      if (this.browser.config.cdp_url) {
        await page.reload(); // Reload the page to avoid timeout errors
      }
      await page.waitForLoadState();
      logger.debug(`New page opened: ${page.url()}`);
      if (this.session != null) {
        this.state.target_id = null;
      }
    };

    this._page_event_handler = on_page;
    context.on("page", on_page);
  }

  async get_session(): Promise<BrowserSession> {
    /**
     * Lazy initialization of the browser and related components
     */
    if (this.session == null) {
      return await this.initialize_session();
    }
    return this.session;
  }

  async get_current_page(): Promise<Page> {
    const session = await this.get_session();
    return await this.session_get_current_page(session);
  }

  async create_context(
    browser: PlaywrightBrowser
  ): Promise<PlaywrightBrowserContext> {
    /**
     * Creates a new browser context with anti-detection measures and loads cookies if available.
     */
    let context: PlaywrightBrowserContext;

    if (this.browser.config.cdp_url && browser.contexts().length > 0) {
      const existingContext = browser.contexts()[0];
      if (!existingContext) {
        // Added check for undefined
        throw new Error(
          "Playwright browser reported contexts available, but the first one was undefined."
        );
      }
      context = existingContext;
    } else if (
      this.browser.config.chrome_instance_path &&
      browser.contexts().length > 0
    ) {
      const existingContext = browser.contexts()[0];
      if (!existingContext) {
        // Added check for undefined
        throw new Error(
          "Playwright browser reported contexts available (chrome_instance_path), but the first one was undefined."
        );
      }
      context = existingContext;
    } else {
      // Original code for creating new context
      context = await browser.newContext({
        viewport: this.config.browser_window_size,
        userAgent: this.config.user_agent,
        javaScriptEnabled: true,
        bypassCSP: this.config.disable_security,
        ignoreHTTPSErrors: this.config.disable_security,
        recordVideo: this.config.save_recording_path
          ? {
              dir: this.config.save_recording_path,
              size: this.config.browser_window_size,
            }
          : undefined,
        locale: this.config.locale || undefined,
      });
    }

    if (this.config.trace_path) {
      await context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true,
      });
    }

    // Load cookies if they exist
    if (this.config.cookies_file && fs.existsSync(this.config.cookies_file)) {
      const cookiesData = fs.readFileSync(this.config.cookies_file, "utf8");
      const cookies = JSON.parse(cookiesData);
      logger.info(
        `Loaded ${cookies.length} cookies from ${this.config.cookies_file}`
      );
      await context.addCookies(cookies);
    }

    // Expose anti-detection scripts
    await context.addInitScript(`
// Webdriver property
Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined
});

// Languages
Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US']
});

// Plugins
Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5]
});

// Chrome runtime
window.chrome = { runtime: {} };

// Permissions
const originalQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
);
(function () {
    const originalAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachShadow(options) {
        return originalAttachShadow.call(this, { ...options, mode: "open" });
    };
})();
`);

    return context;
  }

  async wait_for_stable_network(): Promise<void> {
    const page = await this.get_current_page();

    const pendingRequests = new Set();
    let lastActivity = Date.now();

    // Define relevant resource types and content types
    const RELEVANT_RESOURCE_TYPES = new Set([
      "document",
      "stylesheet",
      "image",
      "font",
      "script",
      "iframe",
    ]);

    const RELEVANT_CONTENT_TYPES = new Set([
      "text/html",
      "text/css",
      "application/javascript",
      "image/",
      "font/",
      "application/json",
    ]);

    // Additional patterns to filter out
    const IGNORED_URL_PATTERNS = new Set([
      // Analytics and tracking
      "analytics",
      "tracking",
      "telemetry",
      "beacon",
      "metrics",
      // Ad-related
      "doubleclick",
      "adsystem",
      "adserver",
      "advertising",
      // Social media widgets
      "facebook.com/plugins",
      "platform.twitter",
      "linkedin.com/embed",
      // Live chat and support
      "livechat",
      "zendesk",
      "intercom",
      "crisp.chat",
      "hotjar",
      // Push notifications
      "push-notifications",
      "onesignal",
      "pushwoosh",
      // Background sync/heartbeat
      "heartbeat",
      "ping",
      "alive",
      // WebRTC and streaming
      "webrtc",
      "rtmp://",
      "wss://",
      // Common CDNs for dynamic content
      "cloudfront.net",
      "fastly.net",
    ]);
    const onRequest = async (request: any): Promise<void> => {
      // Filter by resource type
      if (!RELEVANT_RESOURCE_TYPES.has(request.resourceType())) {
        return;
      }

      // Filter out streaming, websocket, and other real-time requests
      if (
        ["websocket", "media", "eventsource", "manifest", "other"].includes(
          request.resourceType()
        )
      ) {
        return;
      }

      // Filter by URL pattern
      const url = request.url().toLowerCase();
      if (
        Array.from(IGNORED_URL_PATTERNS).some((pattern) =>
          url.includes(pattern)
        )
      ) {
        return;
      }

      // Filter out data URLs and blob URLs
      if (url.startsWith("data:") || url.startsWith("blob:")) {
        return;
      }

      // Filter requests with specific headers
      const headers = request.headers();
      if (
        headers["purpose"] === "prefetch" ||
        ["video", "audio"].includes(headers["sec-fetch-dest"])
      ) {
        return;
      }

      pendingRequests.add(request);
      lastActivity = Date.now();
    };

    const onResponse = async (response: any): Promise<void> => {
      const request = response.request();
      if (!pendingRequests.has(request)) {
        return;
      }

      // Filter by content type (if available)
      const contentType = (
        response.headers()["content-type"] || ""
      ).toLowerCase();

      // Skip if content type indicates streaming or real-time data
      if (
        [
          "streaming",
          "video",
          "audio",
          "webm",
          "mp4",
          "event-stream",
          "websocket",
          "protobuf",
        ].some((t) => contentType.includes(t))
      ) {
        pendingRequests.delete(request);
        return;
      }

      // Only process relevant content types
      if (
        !Array.from(RELEVANT_CONTENT_TYPES).some((ct) =>
          contentType.includes(ct)
        )
      ) {
        pendingRequests.delete(request);
        return;
      }

      // Skip if response is too large (likely not important for page load)
      const contentLength = response.headers()["content-length"];
      if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
        // 5MB
        pendingRequests.delete(request);
        return;
      }

      pendingRequests.delete(request);
      lastActivity = Date.now();
    };

    // Add event listeners
    page.on("request", onRequest);
    page.on("response", onResponse);

    try {
      // Wait for idle time
      const startTime = Date.now();
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const now = Date.now();
        if (
          pendingRequests.size === 0 &&
          now - lastActivity >=
            this.config.wait_for_network_idle_page_load_time * 1000
        ) {
          break;
        }
        if (now - startTime > this.config.maximum_wait_page_load_time * 1000) {
          logger.debug(
            `Network timeout after ${this.config.maximum_wait_page_load_time}s with ${pendingRequests.size} ` +
              `pending requests: ${Array.from(pendingRequests).map((r: any) =>
                r.url()
              )}`
          );
          break;
        }
      }
    } finally {
      // Clean up event listeners
      page.removeListener("request", onRequest);
      page.removeListener("response", onResponse);
    }

    logger.debug(
      `Network stabilized for ${this.config.wait_for_network_idle_page_load_time} seconds`
    );
  }

  async wait_for_page_and_frames_load(
    timeout_overwrite: number | null = null
  ): Promise<void> {
    /**
     * Ensure the page is fully loaded before proceeding.
     * Wait for network idle or minimum wait time, whichever is longer.
     * Also checks if the loaded URL is allowed.
     */
    // Start timing
    const startTime = Date.now();

    // Wait for page load
    try {
      await this.wait_for_stable_network();

      // Check if the loaded URL is allowed
      const page = await this.get_current_page();
      await this.check_and_handle_navigation(page);
    } catch (e) {
      if (e instanceof URLNotAllowedError) {
        throw e;
      }
      logger.warning("Page load failed, continuing...");
    }

    // Calculate remaining time to meet minimum wait time
    const elapsed = (Date.now() - startTime) / 1000;
    const remaining = Math.max(
      (timeout_overwrite || this.config.minimum_wait_page_load_time) - elapsed,
      0
    );

    logger.debug(
      `--Page loaded in ${elapsed.toFixed(
        2
      )} seconds, waiting for additional ${remaining.toFixed(2)} seconds`
    );

    // Wait for remaining time if needed
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining * 1000));
    }
  }

  private _is_url_allowed(url: string): boolean {
    /**
     * Check if the URL is allowed based on the whitelist configuration.
     */
    if (!this.config.allowed_domains) {
      return true;
    }

    try {
      const parsedUrl = new URL(url);
      let domain = parsedUrl.hostname.toLowerCase();

      // Remove port number if present
      if (domain.includes(":")) {
        const domainParts = domain.split(":");
        domain = domainParts[0] ?? ""; // Ensure domain is a string, use empty string as fallback
      }

      // Check if the domain matches any allowed domain patterns
      return this.config.allowed_domains.some(
        (allowedDomain) =>
          domain === allowedDomain.toLowerCase() ||
          domain.endsWith("." + allowedDomain.toLowerCase())
      );
    } catch (e: any) {
      // Typed the caught error
      logger.error(`Error checking URL allowlist: ${(e as Error).message}`); // Safely access message
      return false;
    }
  }

  async check_and_handle_navigation(page: Page): Promise<void> {
    /**
     * Check if the current page URL is allowed, and handle it if not.
     */
    if (!this._is_url_allowed(page.url())) {
      logger.warning(`Navigation to non-allowed URL detected: ${page.url()}`);
      try {
        await this.go_back();
      } catch (e) {
        logger.error(`Failed to go back after detecting non-allowed URL: ${e}`);
      }
      throw new URLNotAllowedError(
        `Navigation to non-allowed URL: ${page.url()}`
      );
    }
  }

  async navigate_to(url: string): Promise<void> {
    /**
     * Navigate to a URL
     */
    if (!this._is_url_allowed(url)) {
      throw new BrowserError(`Navigation to non-allowed URL: ${url}`);
    }

    const page = await this.get_current_page();
    await page.goto(url);
    await page.waitForLoadState();
  }

  async refresh_page(): Promise<void> {
    /**
     * Refresh the current page
     */
    const page = await this.get_current_page();
    await page.reload();
    await page.waitForLoadState();
  }

  async go_back(): Promise<void> {
    /**
     * Go back in history
     */
    const page = await this.get_current_page();
    try {
      // 10ms timeout
      await page.goBack({ timeout: 10, waitUntil: "domcontentloaded" });
    } catch (e) {
      // Continue even if not fully loaded, as we will wait for page load later
      logger.debug(`During go_back: ${e}`);
    }
  }

  async go_forward(): Promise<void> {
    /**
     * Go forward in history
     */
    const page = await this.get_current_page();
    try {
      await page.goForward({ timeout: 10, waitUntil: "domcontentloaded" });
    } catch (e) {
      // Continue even if not fully loaded, as we will wait for page load later
      logger.debug(`During go_forward: ${e}`);
    }
  }

  async close_current_tab(): Promise<void> {
    /**
     * Close the current tab
     */
    const session = await this.get_session();
    const page = await this.session_get_current_page(session);
    await page.close();

    // Switch to the first available tab if present
    const pages = await this.session_get_pages(session);
    if (pages.length) {
      await this.switch_to_tab(0);
    }

    // Otherwise, the browser will be closed
  }

  async get_page_html(): Promise<string> {
    /**
     * Get the HTML content of the current page
     */
    const page = await this.get_current_page();
    return await page.content();
  }

  async execute_javascript(script: string): Promise<any> {
    /**
     * Execute JavaScript code on the page
     */
    const page = await this.get_current_page();
    return await page.evaluate(script);
  }

  async get_page_structure(): Promise<string> {
    /**
     * Get a debug view of the page structure, including iframes
     */
    const debugScript = `(() => {
  function getPageStructure(element = document, depth = 0, maxDepth = 10) {
    if (depth >= maxDepth) return '';

    const indent = '  '.repeat(depth);
    let structure = '';

    // Skip certain elements that clutter the output
    const skipTags = new Set(['script', 'style', 'link', 'meta', 'noscript']);

    // Add current element info if not document
    if (element !== document) {
      const tagName = element.tagName.toLowerCase();

      // Skip uninteresting elements
      if (skipTags.has(tagName)) return '';

      const id = element.id ? \`#\${element.id}\` : '';
      const classes = element.className && typeof element.className === 'string' ?
        \`.\${element.className.split(' ').filter(c => c).join('.')}\` : '';

      // Get other useful attributes
      const attrs = [];
      if (element.getAttribute('role')) attrs.push(\`role="\${element.getAttribute('role')}"\`);
      if (element.getAttribute('aria-label')) attrs.push(\`aria-label="\${element.getAttribute('aria-label')}"\`);
      if (element.getAttribute('type')) attrs.push(\`type="\${element.getAttribute('type')}"\`);
      if (element.getAttribute('name')) attrs.push(\`name="\${element.getAttribute('name')}"\`);
      if (element.getAttribute('src')) {
        const src = element.getAttribute('src');
        attrs.push(\`src="\${src.substring(0, 50)}\${src.length > 50 ? '...' : ''}"\`);
      }

      // Add element info
      structure += \`\${indent}\${tagName}\${id}\${classes}\${attrs.length ? ' [' + attrs.join(', ') + ']' : ''}\\n\`;

      // Special handling for iframes
      if (tagName === 'iframe') {
        try {
          const iframeDoc = element.contentDocument || element.contentWindow?.document;
          if (iframeDoc) {
            structure += \`\${indent}  [IFRAME CONTENT]:\\n\`;
            structure += getPageStructure(iframeDoc, depth + 2, maxDepth);
          } else {
            structure += \`\${indent}  [IFRAME: No access - likely cross-origin]\\n\`;
          }
        } catch (e) {
          structure += \`\${indent}  [IFRAME: Access denied - \${e.message}]\\n\`;
        }
      }
    }

    // Get all child elements
    const children = element.children || element.childNodes;
    for (const child of children) {
      if (child.nodeType === 1) { // Only process element nodes
        structure += getPageStructure(child, depth + 1, maxDepth);
      }
    }

    return structure;
  }

  return getPageStructure();
})()`;

    const page = await this.get_current_page();
    const structure = await page.evaluate(debugScript);
    return structure as string;
  }

  @timeExecutionSync("--get_state")
  async get_state(): Promise<BrowserState> {
    /**
     * Get the current state of the browser
     */
    await this.wait_for_page_and_frames_load();
    const session = await this.get_session();
    session.cached_state = await this._update_state();

    // Save cookies if a file is specified
    if (this.config.cookies_file) {
      void this.save_cookies();
    }

    return session.cached_state;
  }

  private async _update_state(
    focus_element: number = -1
  ): Promise<BrowserState> {
    /**
     * Update and return the state
     */
    const session = await this.get_session();

    // Check if the current page is still valid, and switch to another available page if not
    try {
      const page = await this.get_current_page();
      // Test if the page is still accessible
      await page.evaluate("1");
    } catch (e) {
      logger.debug(`Current page is no longer accessible: ${e}`);
      // Get all available pages
      const pages = await this.session_get_pages(session);
      if (pages.length) {
        this.state.target_id = null;
        const page = await this.session_get_current_page(session);
        logger.debug(`Switched to page: ${await page.title()}`);
      } else {
        throw new BrowserError("Browser is closed: No valid pages available");
      }
    }

    try {
      await this.remove_highlights();
      const dom_service = new DomService(await this.get_current_page());
      const content = await dom_service.get_clickable_elements(
        this.config.highlight_elements,
        focus_element,
        this.config.viewport_expansion
      );

      const screenshot_b64 = await this.take_screenshot();
      const [pixels_above, pixels_below] = await this.get_scroll_info(
        await this.get_current_page()
      );
      this.current_state = new BrowserState({
        url: (await this.get_current_page()).url(),
        title: await (await this.get_current_page()).title(),
        tabs: await this.get_tabs_info(),
        screenshot: screenshot_b64,
        pixels_above,
        pixels_below,
        element_tree: content.element_tree,
        selector_map: content.selector_map,
      });

      return this.current_state;
    } catch (e) {
      logger.error(`Failed to update state: ${e}`);
      // Return the last known good state if available
      if (this.current_state) {
        return this.current_state;
      }
      throw e;
    }
  }

  // region - Browser operations
  @timeExecutionAsync("--take_screenshot")
  async take_screenshot(full_page: boolean = false): Promise<string> {
    /**
     * Return a base64-encoded screenshot of the current page
     */
    const page = await this.get_current_page();

    await page.bringToFront();
    await page.waitForLoadState();

    const screenshot = await page.screenshot({
      fullPage: full_page,
      animations: "disabled",
    });

    const screenshot_b64 = Buffer.from(screenshot).toString("base64");

    return screenshot_b64;
  }

  @timeExecutionAsync("--remove_highlights")
  async remove_highlights(): Promise<void> {
    /**
     * Remove all highlight overlays and tags created by the highlightElement function
     * Handle cases where the page may have been closed or is inaccessible
     */
    try {
      const page = await this.get_current_page();
      await page.evaluate(`
try {
    // Remove the highlight container and all its contents
    const container = document.getElementById('playwright-highlight-container');
    if (container) {
        container.remove();
    }

    // Remove highlight attributes from elements
    const highlightedElements = document.querySelectorAll('[browser-user-highlight-id^="playwright-highlight-"]');
    highlightedElements.forEach(el => {
        el.removeAttribute('browser-user-highlight-id');
    });
} catch (e) {
    console.error('Failed to remove highlights:', e);
}`);
    } catch (e) {
      logger.debug(`Failed to remove highlights (this is usually okay): ${e}`);
      // Do not throw an error as this is not a critical function
    }
  }
  // endregion

  // region - User operations

  private static _convert_simple_xpath_to_css_selector(xpath: string): string {
    /**
     * Convert simple XPath expressions to CSS selectors
     */
    if (!xpath) {
      return "";
    }

    // Remove leading slash if present
    xpath = xpath.replace(/^\//, "");

    // Split into parts
    const parts = xpath.split("/");
    const css_parts: string[] = [];

    for (const part of parts) {
      if (!part) {
        continue;
      }

      // Handle custom elements with colons by escaping them
      if (part.includes(":") && !part.includes("[")) {
        const base_part = part.replace(/:/g, "\\:");
        css_parts.push(base_part);
        continue;
      }

      // Handle index notation [n]
      if (part.includes("[")) {
        const base_part_end = part.indexOf("[");
        let base_part = part.substring(0, base_part_end);
        // Handle custom elements with colons in the base part
        if (base_part.includes(":")) {
          base_part = base_part.replace(/:/g, "\\:");
        }
        const index_part = part.substring(base_part_end);

        // Handle multiple indices
        const indices = index_part
          .split("]")
          .slice(0, -1)
          .map((i) => i.replace("[", "").trim());

        for (const idx of indices) {
          try {
            // Handle numeric indices
            if (/^\d+$/.test(idx)) {
              const index = parseInt(idx) - 1;
              base_part += `:nth-of-type(${index + 1})`;
            }
            // Handle last() function
            else if (idx === "last()") {
              base_part += ":last-of-type";
            }
            // Handle position() function
            else if (idx.includes("position()")) {
              if (idx.includes(">1")) {
                base_part += ":nth-of-type(n+2)";
              }
            }
          } catch (e) {
            continue;
          }
        }

        css_parts.push(base_part);
      } else {
        css_parts.push(part);
      }
    }

    const base_selector = css_parts.join(" > ");
    return base_selector;
  }

  @timeExecutionSync("--enhanced_css_selector_for_element")
  static enhanced_css_selector_for_element(
    element: DOMElementNode,
    include_dynamic_attributes: boolean = true
  ): string {
    /**
     * Create a CSS selector for a DOM element, handling various edge cases and special characters
     *
     * Parameters:
     *   element: The DOM element to create a selector for
     *
     * Returns:
     *   A valid CSS selector string
     */
    try {
      // Get the base selector from XPath
      let css_selector = this._convert_simple_xpath_to_css_selector(
        element.xpath
      );

      // Handle class attribute
      if (element.attributes["class"] && include_dynamic_attributes) {
        // Define a regex pattern for valid class names in CSS
        const valid_class_name_pattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

        // Iterate over class attribute values
        const classes = element.attributes["class"].split(/\s+/);
        for (const class_name of classes) {
          // Skip empty class names
          if (!class_name.trim()) {
            continue;
          }

          // Check if the class name is valid
          if (valid_class_name_pattern.test(class_name)) {
            // Append valid class name to the CSS selector
            css_selector += `.${class_name}`;
          } else {
            // Skip invalid class names
            continue;
          }
        }
      }

      // Extended safe attribute set, these attributes are stable and useful for selection
      const SAFE_ATTRIBUTES = new Set([
        // Data attributes (if they are stable in your application)
        "id",
        // Standard HTML attributes
        "name",
        "type",
        "placeholder",
        // Accessibility attributes
        "aria-label",
        "aria-labelledby",
        "aria-describedby",
        "role",
        // Common form attributes
        "for",
        "autocomplete",
        "required",
        "readonly",
        // Media attributes
        "alt",
        "title",
        "src",
        // Custom stable attributes (add any application-specific attributes)
        "href",
        "target",
      ]);

      if (include_dynamic_attributes) {
        const dynamic_attributes = new Set([
          "data-id",
          "data-qa",
          "data-cy",
          "data-testid",
        ]);

        for (const attr of dynamic_attributes) {
          SAFE_ATTRIBUTES.add(attr);
        }
      }

      // Handle other attributes
      for (const [attribute, value] of Object.entries(element.attributes)) {
        if (attribute === "class") {
          continue;
        }

        // Skip invalid attribute names
        if (!attribute.trim()) {
          continue;
        }

        if (!SAFE_ATTRIBUTES.has(attribute)) {
          continue;
        }

        // Escape special characters in attribute names
        const safe_attribute = attribute.replace(/:/g, "\\:");

        // Handle different value cases
        if (value === "") {
          css_selector += `[${safe_attribute}]`;
        } else if (/["'<>`\n\r\t]/.test(value)) {
          // Use contains for values with special characters
          // Regex replace *any* whitespace with a single space, then trim
          const collapsed_value = value.replace(/\s+/g, " ").trim();
          // Escape embedded double quotes
          const safe_value = collapsed_value.replace(/"/g, '\\"');
          css_selector += `[${safe_attribute}*="${safe_value}"]`;
        } else {
          css_selector += `[${safe_attribute}="${value}"]`;
        }
      }

      return css_selector;
    } catch (e) {
      // Fallback to a more basic selector if something goes wrong
      const tag_name = element.tag_name || "*";
      return `${tag_name}[highlight_index='${element.highlight_index}']`;
    }
  }

  @timeExecutionAsync("--get_locate_element")
  async get_locate_element(
    element: DOMElementNode
  ): Promise<ElementHandle | null> {
    let current_frame: Page | FrameLocator = await this.get_current_page();

    // Start with the target element and collect all parent elements
    const parents: DOMElementNode[] = [];
    let current = element;
    while (current.parent != null) {
      const parent = current.parent;
      parents.push(parent);
      current = parent;
    }

    // Reverse the parent list to process from top to bottom
    parents.reverse();

    // Process all iframe parents in order
    const iframes = parents.filter((item) => item.tag_name === "iframe");
    for (const parent of iframes) {
      const css_selector = BrowserContext.enhanced_css_selector_for_element(
        parent,
        this.config.include_dynamic_attributes
      );
      current_frame = (current_frame as Page).frameLocator(css_selector);
    }

    const css_selector = BrowserContext.enhanced_css_selector_for_element(
      element,
      this.config.include_dynamic_attributes
    );

    try {
      if ((current_frame as FrameLocator).locator) {
        const element_handle = await current_frame
          .locator(css_selector)
          .first()
          .elementHandle();
        return element_handle;
      } else {
        // Attempt to scroll into view if hidden
        const element_handle = await (current_frame as Page)
          .locator(css_selector)
          .first();
        if (element_handle) {
          await element_handle.scrollIntoViewIfNeeded();
          return element_handle.elementHandle();
        }
        return null;
      }
    } catch (e) {
      logger.error(`Failed to locate element: ${(e as Error).stack}`);
      return null;
    }
  }

  @timeExecutionAsync("--input_text_element_node")
  async input_text_element_node(
    element_node: DOMElementNode,
    text: string
  ): Promise<void> {
    /**
     * Input text into an element with proper error handling and state management.
     * Handles different types of input fields and ensures the element state is correct before input.
     */
    try {
      const element_handle = await this.get_locate_element(element_node);

      if (element_handle == null) {
        throw new BrowserError(`Element: ${element_node} not found`);
      }

      // Ensure the element is ready for input
      try {
        await element_handle.waitForElementState("stable", { timeout: 1000 });
        await element_handle.scrollIntoViewIfNeeded({ timeout: 1000 });
      } catch (e) {
        // Ignore wait errors
      }

      // Get element attributes to determine input method
      const tag_handle = await element_handle.getProperty("tagName");
      const tag_name = ((await tag_handle.jsonValue()) as string).toLowerCase();
      const is_contenteditable = await element_handle.getProperty(
        "isContentEditable"
      );
      const readonly_handle = await element_handle.getProperty("readOnly");
      const disabled_handle = await element_handle.getProperty("disabled");

      const readonly = readonly_handle
        ? await readonly_handle.jsonValue()
        : false;
      const disabled = disabled_handle
        ? await disabled_handle.jsonValue()
        : false;

      if (
        ((await is_contenteditable.jsonValue()) || tag_name === "input") &&
        !(readonly || disabled)
      ) {
        await element_handle.evaluate('el => el.textContent = ""');
        await element_handle.type(text, { delay: 5 });
      } else {
        await element_handle.fill(text);
      }
    } catch (e) {
      logger.error(`Failed to input text: ${e}`);
      throw new BrowserError(`Failed to input text: ${e}`);
    }
  }

  @timeExecutionAsync("--click_element_node")
  async click_element_node(
    elementNode: DOMElementNode
  ): Promise<string | null> {
    const page = await this.get_current_page();

    try {
      // Highlight before clicking
      // if (elementNode.highlightIndex != null) {
      //   await this._updateState({ focusElement: elementNode.highlightIndex });
      // }

      const elementHandle = await this.get_locate_element(elementNode);

      if (!elementHandle) {
        throw new Error(`Element: ${elementNode.toString()} not found`);
      }

      const performClick = async (
        clickFunc: () => Promise<void>
      ): Promise<string | null> => {
        if (this.config.save_downloads_path) {
          try {
            // Try short-timeout expect_download to detect a file download has been triggered
            const downloadPromise = page.waitForEvent("download", {
              timeout: 5000,
            });
            await clickFunc();
            const download = await downloadPromise;

            // Determine file path
            const suggestedFilename = download.suggestedFilename();
            const uniqueFilename = await this._getUniqueFilename(
              this.config.save_downloads_path,
              suggestedFilename
            );
            const downloadPath = path.join(
              this.config.save_downloads_path,
              uniqueFilename
            );
            await download.saveAs(downloadPath);
            logger.debug(`Download triggered. Saved file to: ${downloadPath}`);
            return downloadPath;
          } catch (e) {
            if ((e as Error).message.includes("timeout")) {
              // If no download is triggered, treat as normal click
              logger.debug(
                "No download triggered within timeout. Checking navigation..."
              );
              await page.waitForLoadState();
              await this.check_and_handle_navigation(page);
            } else {
              throw e;
            }
          }
        } else {
          // Standard click logic if no download is expected
          await clickFunc();
          await page.waitForLoadState();
          await this.check_and_handle_navigation(page);
        }
        return null;
      };

      try {
        return await performClick(
          async () => await elementHandle.click({ timeout: 1500 })
        );
      } catch (e) {
        if (e instanceof URLNotAllowedError) {
          throw e;
        }
        try {
          return await performClick(
            async () => await page.evaluate("(el) => el.click()", elementHandle)
          );
        } catch (innerE) {
          if (innerE instanceof URLNotAllowedError) {
            throw innerE;
          }
          throw new Error(
            `Failed to click element: ${(innerE as Error).message}`
          );
        }
      }
    } catch (e) {
      if (e instanceof URLNotAllowedError) {
        throw e;
      }
      throw new Error(
        `Failed to click element: ${elementNode.toString()}. Error: ${
          (e as Error).message
        }`
      );
    }
  }

  async input_text(element_index: number, text: string): Promise<void> {
    /**
     * Input text into the element at the specified index
     */
    await this.wait_for_page_and_frames_load();
    const session = await this.get_session();

    if (!session.cached_state) {
      session.cached_state = await this._update_state();
    }

    const selector_map = session.cached_state.selector_map;
    if (!selector_map || !selector_map[element_index]) {
      throw new BrowserError(
        `Element index ${element_index} does not exist in the selector map`
      );
    }

    const element_node = selector_map[element_index];
    await this.input_text_element_node(element_node, text);

    // Wait for page load
    await this.wait_for_page_and_frames_load();

    // Update state
    session.cached_state = await this._update_state(element_index);
  }

  async click_element(element_index: number): Promise<void> {
    /**
     * Click the element at the specified index
     */
    await this.wait_for_page_and_frames_load();
    const session = await this.get_session();

    if (!session.cached_state) {
      session.cached_state = await this._update_state();
    }

    const selector_map = session.cached_state.selector_map;
    if (!selector_map || !selector_map[element_index]) {
      throw new BrowserError(
        `Element index ${element_index} does not exist in the selector map`
      );
    }

    const element_node = selector_map[element_index];
    await this.click_element_node(element_node);

    // Wait for page load
    await this.wait_for_page_and_frames_load();

    // Update state
    session.cached_state = await this._update_state();
  }

  async click_element_by_selector(selector: string): Promise<void> {
    /**
     * Click an element by CSS selector
     */
    await this.wait_for_page_and_frames_load();
    const page = await this.get_current_page();

    try {
      await page.click(selector);
    } catch (e) {
      throw new BrowserError(
        `Failed to click element by selector ${selector}: ${e}`
      );
    }

    // Wait for page load
    await this.wait_for_page_and_frames_load();

    // Update state
    const session = await this.get_session();
    session.cached_state = await this._update_state();
  }

  async input_text_by_selector(selector: string, text: string): Promise<void> {
    /**
     * Input text into an element by CSS selector
     */
    await this.wait_for_page_and_frames_load();
    const page = await this.get_current_page();

    try {
      await page.fill(selector, text);
    } catch (e) {
      throw new BrowserError(
        `Failed to input text by selector ${selector}: ${e}`
      );
    }

    // Wait for page load
    await this.wait_for_page_and_frames_load();

    // Update state
    const session = await this.get_session();
    session.cached_state = await this._update_state();
  }

  async press_key(key: string): Promise<void> {
    /**
     * Press a keyboard key
     */
    await this.wait_for_page_and_frames_load();
    const page = await this.get_current_page();

    try {
      await page.keyboard.press(key);
    } catch (e) {
      throw new BrowserError(`Failed to press key ${key}: ${e}`);
    }

    // Wait for page load
    await this.wait_for_page_and_frames_load();

    // Update state
    const session = await this.get_session();
    session.cached_state = await this._update_state();
  }

  async save_cookies(): Promise<void> {
    /**
     * Save cookies of the current session to a file
     */
    if (!this.config.cookies_file || !this.session) {
      return;
    }

    try {
      const cookies = await this.session.context.cookies();
      const cookiesJson = JSON.stringify(cookies, null, 2);
      fs.writeFileSync(this.config.cookies_file, cookiesJson);
      logger.debug(
        `Saved ${cookies.length} cookies to ${this.config.cookies_file}`
      );
    } catch (e) {
      logger.error(`Failed to save cookies: ${e}`);
    }
  }

  async session_get_pages(session: BrowserSession): Promise<Page[]> {
    if (this.config.mode === "electron-view") {
      // Assuming electronWebviewContext is guaranteed to be defined if mode is 'electron-view'
      // based on initialization logic.
      return await this.browser.config.electronWebviewContext!.pages(session);
    }
    return session.context.pages();
  }

  async session_new_page(session: BrowserSession): Promise<Page> {
    if (this.config.mode === "electron-view") {
      // Assuming electronWebviewContext is guaranteed to be defined if mode is 'electron-view'
      return await this.browser.config.electronWebviewContext!.newPage(session);
    }
    return session.context.newPage();
  }

  async session_get_current_page(session: BrowserSession): Promise<Page> {
    /**
     * Get the current active page
     */
    const pages = await this.session_get_pages(session);
    if (!pages.length) {
      return await this.session_new_page(session);
    }

    // If there is a target ID, try to find the matching page
    if (this.state.target_id && this.browser.config.cdp_url) {
      const targets = await this._get_cdp_targets();
      for (const target of targets) {
        if (target.id === this.state.target_id) {
          for (const page of pages) {
            if (page.url() === target.url) {
              return page;
            }
          }
        }
      }
    }

    // Use the first page if no matching page is found
    // Non-null assertion is safe due to the `!pages.length` check earlier.
    return pages[pages.length - 1]!;
  }

  private async _get_cdp_targets(): Promise<CDPTarget[]> {
    /**
     * Get the list of CDP targets
     */
    if (!this.browser.config.cdp_url) {
      return [];
    }

    try {
      const response = await fetch(`${this.browser.config.cdp_url}/json/list`);
      const targets = (await response.json()) as CDPTarget[];
      return targets.filter((target: CDPTarget) => {
        return !target.url.startsWith("devtools://") && target.type === "page";
      });
    } catch (e) {
      logger.error(`Failed to get CDP targets: ${e}`);
      return [];
    }
  }

  async get_tabs_info(): Promise<TabInfo[]> {
    /**
     * Get information about all tabs
     */
    const session = await this.get_session();
    const pages = await this.session_get_pages(session);
    const tabs: TabInfo[] = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!; // Non-null assertion as we are iterating within bounds
      tabs.push({
        page_id: i,
        url: page.url(),
        title: await page.title(),
      });
    }

    return tabs;
  }

  async switch_to_tab(tab_index: number): Promise<void> {
    /**
     * Switch to the tab at the specified index
     */
    const session = await this.get_session();
    const pages = await this.session_get_pages(session);

    if (tab_index < 0 || tab_index >= pages.length) {
      throw new BrowserError(
        `Invalid tab index: ${tab_index}, available tabs: ${pages.length}`
      );
    }

    const page = pages[tab_index]!; // Non-null assertion as index is checked
    if (page) { // Added null check for safety, though `!` should suffice
      page.bringToFront && (await page.bringToFront());

      // Update target ID
      if (this.browser.config.cdp_url) {
        const targets = await this._get_cdp_targets();
        for (const target of targets) {
          if (target.url === page.url()) {
            this.state.target_id = target.id;
            break;
          }
        }
      }
    }
  }

  async reset_context(): Promise<void> {
    // Reset the browser session
    // Call this when you don't want to kill the context but just kill the state

    // close all tabs and clear cached state
    const session = await this.get_session();

    const pages = await this.session_get_pages(session);
    for (const page of pages) {
      await page.close();
    }

    session.cached_state = null;
    this.state.target_id = null;
  }

  async _getUniqueFilename(
    directory: string,
    filename: string
  ): Promise<string> {
    // Generate a unique filename by appending (1), (2), etc., if a file already exists
    const { base, ext } = path.parse(filename);
    let counter = 1;
    let newFilename = filename;

    while (fs.existsSync(path.join(directory, newFilename))) {
      newFilename = `${base} (${counter})${ext}`;
      counter++;
    }

    return newFilename;
  }

  async get_scroll_info(page: Page): Promise<[number, number]> {
    /**
     * Get page scroll information
     * Returns: [pixels_above, pixels_below]
     */
    const scrollInfo = await page.evaluate(() => {
      const scrollTop =
        window.pageYOffset || document.documentElement.scrollTop;
      const scrollHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight
      );
      const clientHeight = document.documentElement.clientHeight;

      return {
        pixels_above: Math.round(scrollTop),
        pixels_below: Math.round(
          Math.max(0, scrollHeight - clientHeight - scrollTop)
        ),
      };
    });

    return [scrollInfo.pixels_above, scrollInfo.pixels_below];
  }

  async scroll_page(
    direction: "up" | "down",
    amount: number = 300
  ): Promise<void> {
    /**
     * Scroll the page
     *
     * Parameters:
     *   direction: Scroll direction ('up' or 'down')
     *   amount: Number of pixels to scroll
     */
    const page = await this.get_current_page();
    const scrollAmount = direction === "up" ? -amount : amount;

    await page.evaluate((scrollY) => {
      window.scrollBy(0, scrollY);
    }, scrollAmount);

    // Wait for scroll to complete
    await page.waitForTimeout(100);
  }
  async get_selector_map(): Promise<SelectorMap> {
    const session = await this.get_session();
    if (session.cached_state == null) {
      return {};
    }
    return session.cached_state.selector_map;
  }

  async getElementByIndex(index: number): Promise<ElementHandle | null> {
    const selectorMap = await this.get_selector_map();
    const elementNode = selectorMap[index];
    if (!elementNode) {
      logger.warn(`Element with index ${index} not found in selectorMap.`);
      return null;
    }
    const elementHandle = await this.get_locate_element(elementNode);
    return elementHandle;
  }

  async getDomElementByIndex(index: number): Promise<DOMElementNode | undefined> {
    const selectorMap = await this.get_selector_map();
    const elementNode = selectorMap[index];
    if (!elementNode) {
      logger.warn(`Element with index ${index} not found in selectorMap.`);
      return undefined;
    }
    return elementNode;
  }

  async is_file_uploader(
    elementNode: DOMElementNode,
    maxDepth: number = 3,
    currentDepth: number = 0
  ): Promise<boolean> {
    if (currentDepth > maxDepth) {
      return false;
    }

    // Check current element
    let isUploader = false;

    if (!(elementNode instanceof DOMElementNode)) {
      return false;
    }

    // Check for file input attributes
    if (elementNode.tag_name === "input") {
      isUploader =
        elementNode.attributes.type === "file" ||
        !!elementNode.attributes.accept;
    }

    if (isUploader) {
      return true;
    }

    // Recursively check children
    if (elementNode.children && currentDepth < maxDepth) {
      for (const child of elementNode.children) {
        if (child instanceof DOMElementNode) {
          if (await this.is_file_uploader(child, maxDepth, currentDepth + 1)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  @timeExecutionAsync("--create_new_tab")
  async create_new_tab(url?: string): Promise<void> {
    // Create a new tab and optionally navigate to a URL
    if (url && !this._is_url_allowed(url)) {
      throw new BrowserError(
        `Cannot create new tab with non-allowed URL: ${url}`
      );
    }

    const session = await this.get_session();
    const newPage = await this.session_new_page(session);
    if (newPage) { // Added null check
      await newPage.waitForLoadState();

      if (url) {
        await newPage.goto(url);
        await this.wait_for_page_and_frames_load(1);
      }

      // Get target ID for new page if using CDP
      if (this.browser.config.cdp_url) {
        const targets = await this._get_cdp_targets();
        for (const target of targets) {
          if (target.url === newPage.url()) {
            this.state.target_id = target.id;
            break;
          }
        }
      }
    }
  }
}

export {
  BrowserContext,
  BrowserContextConfig,
  BrowserContextState,
  BrowserSession,
};
