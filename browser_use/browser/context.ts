/**
 * Playwright browser on steroids.
 */

import { Browser as PlaywrightBrowser } from 'playwright';
import { BrowserContext as PlaywrightBrowserContext } from 'playwright';
import { ElementHandle, FrameLocator, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import { v4 as uuidv4 } from 'uuid';

// Importing equivalent views and services
import { BrowserError, BrowserState, TabInfo, URLNotAllowedError } from './views';
import { DomService } from '../dom/service';
import { DOMElementNode, SelectorMap } from '../dom/views';
import { timeExecutionAsync, timeExecutionSync } from '../utils';
import { Browser } from "./browser";
import { Logger } from '../utils';

export { Browser } from 'playwright';

const logger = new Logger('browser_context');

// TypeScript equivalent of TypedDict
interface BrowserContextWindowSize {
  width: number;
  height: number;
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
  user_agent: string = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.102 Safari/537.36';

  highlight_elements: boolean = true;
  viewport_expansion: number = 500;
  allowed_domains: string[] | null = null;
  include_dynamic_attributes: boolean = true;

  _force_keep_context_alive: boolean = false;
}

interface BrowserSession {
  context: PlaywrightBrowserContext;
  cached_state: BrowserState | null;
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
  browser: any; // Reference to the Browser class
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
    logger.debug(`Initializing new browser context with id: ${this.context_id}`);

    this.config = config;
    this.browser = browser;
    this.state = state || {
      target_id: null
    };
  }

  async [Symbol.asyncDispose](): Promise<void> {
    /**
     * Async disposable pattern (equivalent to __aexit__)
     */
    await this.close();
  }

  @timeExecutionAsync('--close')
  async close(): Promise<void> {
    /**
     * Close the browser instance
     */
    logger.debug('Closing browser context');

    try {
      if (this.session === null) {
        return;
      }

      // Then remove CDP protocol listeners
      if (this._page_event_handler && this.session.context) {
        try {
          // This actually sends a CDP command to unsubscribe
          this.session.context.removeListener('page', this._page_event_handler);
        } catch (e) {
          logger.debug(`Failed to remove CDP listener: ${e}`);
        }
        this._page_event_handler = null;
      }

      await this.save_cookies();

      if (this.config.trace_path) {
        try {
          await this.session.context.tracing.stop({
            path: path.join(this.config.trace_path, `${this.context_id}.zip`)
          });
        } catch (e) {
          logger.debug(`Failed to stop tracing: ${e}`);
        }
      }

      // This is crucial - it closes the CDP connection
      if (!this.config._force_keep_context_alive) {
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

  @timeExecutionAsync('--initialize_session')
  async _initialize_session(): Promise<BrowserSession> {
    /**
     * Initialize the browser session
     */
    logger.debug('Initializing browser context');

    const playwright_browser = await this.browser.get_playwright_browser();
    const context = await this._create_context(playwright_browser);
    this._page_event_handler = null;

    // Get or create a page to use
    const pages = context.pages();

    this.session = {
      context,
      cached_state: null
    };

    let active_page = null;
    if (this.browser.config.cdp_url) {
      // If we have a saved target ID, try to find and activate it
      if (this.state.target_id) {
        const targets = await this._get_cdp_targets();
        for (const target of targets) {
          if (target['targetId'] === this.state.target_id) {
            // Find matching page by URL
            for (const page of pages) {
              if (page.url() === target['url']) {
                active_page = page;
                break;
              }
            }
            break;
          }
        }
      }
    }

    // If no target ID or couldn't find it, use existing page or create new
    if (!active_page) {
      if (pages.length) {
        active_page = await this._getActivePage(pages);
        logger.debug('Using existing page');
      } else {
        active_page = await context.newPage();
        logger.debug('Created new page');
      }

      // Get target ID for the active page
      if (this.browser.config.cdp_url) {
        const targets = await this._get_cdp_targets();
        for (const target of targets) {
          if (target['url'] === active_page.url()) {
            this.state.target_id = target['targetId'];
            break;
          }
        }
      }
    }

    // Bring page to front
    await active_page.bringToFront();
    await active_page.waitForLoadState('load');

    return this.session;
  }
  async _getActivePage(pages: Page[]): Promise<Page> {
    for (const page of pages) {
      // Check if this page is the active one
      const isVisible = await page.evaluate(() => document.visibilityState === 'visible');
      if (isVisible) {
        return page;
      }
    }
    return pages[pages.length - 1];
  };
  _add_new_page_listener(context: PlaywrightBrowserContext): void {
    const on_page = async (page: Page): Promise<void> => {
      if (this.browser.config.cdp_url) {
        await page.reload(); // Reload the page to avoid timeout errors
      }
      await page.waitForLoadState();
      logger.debug(`New page opened: ${page.url()}`);
      if (this.session !== null) {
        this.state.target_id = null;
      }
    };

    this._page_event_handler = on_page;
    context.on('page', on_page);
  }

  async get_session(): Promise<BrowserSession> {
    /**
     * Lazy initialization of the browser and related components
     */
    if (this.session === null) {
      return await this._initialize_session();
    }
    return this.session;
  }

  async get_current_page(): Promise<Page> {
    /**
     * Get the current page
     */
    const session = await this.get_session();
    return await this._get_current_page(session);
  }

  async _create_context(browser: PlaywrightBrowser): Promise<PlaywrightBrowserContext> {
    /**
     * Creates a new browser context with anti-detection measures and loads cookies if available.
     */
    let context: PlaywrightBrowserContext;

    if (this.browser.config.cdp_url && browser.contexts().length > 0) {
      context = browser.contexts()[0];
    } else if (this.browser.config.chrome_instance_path && browser.contexts().length > 0) {
      // Connect to existing Chrome instance instead of creating new one
      context = browser.contexts()[0];
    } else {
      // Original code for creating new context
      context = await browser.newContext({
        viewport: this.config.browser_window_size,
        userAgent: this.config.user_agent,
        javaScriptEnabled: true,
        bypassCSP: this.config.disable_security,
        ignoreHTTPSErrors: this.config.disable_security,
        recordVideo: this.config.save_recording_path ? {
          dir: this.config.save_recording_path,
          size: this.config.browser_window_size
        } : undefined,
        locale: this.config.locale || undefined
      });
    }

    if (this.config.trace_path) {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    }

    // Load cookies if they exist
    if (this.config.cookies_file && fs.existsSync(this.config.cookies_file)) {
      const cookiesData = fs.readFileSync(this.config.cookies_file, 'utf8');
      const cookies = JSON.parse(cookiesData);
      logger.info(`Loaded ${cookies.length} cookies from ${this.config.cookies_file}`);
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

  async _wait_for_stable_network(): Promise<void> {
    const page = await this.get_current_page();

    const pendingRequests = new Set();
    let lastActivity = Date.now();

    // Define relevant resource types and content types
    const RELEVANT_RESOURCE_TYPES = new Set([
      'document',
      'stylesheet',
      'image',
      'font',
      'script',
      'iframe',
    ]);

    const RELEVANT_CONTENT_TYPES = new Set([
      'text/html',
      'text/css',
      'application/javascript',
      'image/',
      'font/',
      'application/json',
    ]);

    // Additional patterns to filter out
    const IGNORED_URL_PATTERNS = new Set([
      // Analytics and tracking
      'analytics',
      'tracking',
      'telemetry',
      'beacon',
      'metrics',
      // Ad-related
      'doubleclick',
      'adsystem',
      'adserver',
      'advertising',
      // Social media widgets
      'facebook.com/plugins',
      'platform.twitter',
      'linkedin.com/embed',
      // Live chat and support
      'livechat',
      ,
      'zendesk',
      'intercom',
      'crisp.chat',
      'hotjar',
      // Push notifications
      'push-notifications',
      'onesignal',
      'pushwoosh',
      // Background sync/heartbeat
      'heartbeat',
      'ping',
      'alive',
      // WebRTC and streaming
      'webrtc',
      'rtmp://',
      'wss://',
      // Common CDNs for dynamic content
      'cloudfront.net',
      'fastly.net',
    ]);
    const onRequest = async (request: any): Promise<void> => {
      // 按资源类型过滤
      if (!RELEVANT_RESOURCE_TYPES.has(request.resourceType())) {
        return;
      }

      // 过滤流媒体、websocket和其他实时请求
      if (['websocket', 'media', 'eventsource', 'manifest', 'other'].includes(request.resourceType())) {
        return;
      }

      // 按URL模式过滤
      const url = request.url().toLowerCase();
      if (Array.from(IGNORED_URL_PATTERNS).some(pattern => url.includes(pattern))) {
        return;
      }

      // 过滤data URL和blob URL
      if (url.startsWith('data:') || url.startsWith('blob:')) {
        return;
      }

      // 过滤带有特定头部的请求
      const headers = request.headers();
      if (headers['purpose'] === 'prefetch' || ['video', 'audio'].includes(headers['sec-fetch-dest'])) {
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

      // 按内容类型过滤（如果可用）
      const contentType = (response.headers()['content-type'] || '').toLowerCase();

      // 如果内容类型表示流媒体或实时数据，则跳过
      if (['streaming', 'video', 'audio', 'webm', 'mp4', 'event-stream', 'websocket', 'protobuf'].some(
        t => contentType.includes(t)
      )) {
        pendingRequests.delete(request);
        return;
      }

      // 只处理相关内容类型
      if (!Array.from(RELEVANT_CONTENT_TYPES).some(ct => contentType.includes(ct))) {
        pendingRequests.delete(request);
        return;
      }

      // 如果响应太大（可能对页面加载不重要），则跳过
      const contentLength = response.headers()['content-length'];
      if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) { // 5MB
        pendingRequests.delete(request);
        return;
      }

      pendingRequests.delete(request);
      lastActivity = Date.now();
    };

    // 添加事件监听器
    page.on('request', onRequest);
    page.on('response', onResponse);

    try {
      // 等待空闲时间
      const startTime = Date.now();
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const now = Date.now();
        if (pendingRequests.size === 0 && (now - lastActivity) >= this.config.wait_for_network_idle_page_load_time * 1000) {
          break;
        }
        if (now - startTime > this.config.maximum_wait_page_load_time * 1000) {
          logger.debug(
            `Network timeout after ${this.config.maximum_wait_page_load_time}s with ${pendingRequests.size} ` +
            `pending requests: ${Array.from(pendingRequests).map((r: any) => r.url())}`
          );
          break;
        }
      }
    } finally {
      // 清理事件监听器
      page.removeListener('request', onRequest);
      page.removeListener('response', onResponse);
    }

    logger.debug(`Network stabilized for ${this.config.wait_for_network_idle_page_load_time} seconds`);
  }

  async _wait_for_page_and_frames_load(timeout_overwrite: number | null = null): Promise<void> {
    /**
     * 确保页面完全加载后再继续。
     * 等待网络空闲或最小等待时间，以较长者为准。
     * 还检查加载的URL是否被允许。
     */
    // 开始计时
    const startTime = Date.now();

    // 等待页面加载
    try {
      await this._wait_for_stable_network();

      // 检查加载的URL是否被允许
      const page = await this.get_current_page();
      await this._check_and_handle_navigation(page);
    } catch (e) {
      if (e instanceof URLNotAllowedError) {
        throw e;
      }
      logger.warning('Page load failed, continuing...');
    }

    // 计算剩余时间以满足最小等待时间
    const elapsed = (Date.now() - startTime) / 1000;
    const remaining = Math.max((timeout_overwrite || this.config.minimum_wait_page_load_time) - elapsed, 0);

    logger.debug(`--Page loaded in ${elapsed.toFixed(2)} seconds, waiting for additional ${remaining.toFixed(2)} seconds`);

    // 如果需要，等待剩余时间
    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining * 1000));
    }
  }

  _is_url_allowed(url: string): boolean {
    /**
     * 根据白名单配置检查URL是否被允许。
     */
    if (!this.config.allowed_domains) {
      return true;
    }

    try {
      const parsedUrl = new URL(url);
      let domain = parsedUrl.hostname.toLowerCase();

      // 如果存在端口号，则移除
      if (domain.includes(':')) {
        domain = domain.split(':')[0];
      }

      // 检查域名是否匹配任何允许的域名模式
      return this.config.allowed_domains.some(
        allowedDomain => domain === allowedDomain.toLowerCase() || domain.endsWith('.' + allowedDomain.toLowerCase())
      );
    } catch (e) {
      logger.error(`Error checking URL allowlist: ${e}`);
      return false;
    }
  }

  async _check_and_handle_navigation(page: Page): Promise<void> {
    /**
     * 检查当前页面URL是否被允许，如果不允许则处理。
     */
    if (!this._is_url_allowed(page.url())) {
      logger.warning(`Navigation to non-allowed URL detected: ${page.url()}`);
      try {
        await this.go_back();
      } catch (e) {
        logger.error(`Failed to go back after detecting non-allowed URL: ${e}`);
      }
      throw new URLNotAllowedError(`Navigation to non-allowed URL: ${page.url()}`);
    }
  }

  async navigate_to(url: string): Promise<void> {
    /**
     * 导航到URL
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
     * 刷新当前页面
     */
    const page = await this.get_current_page();
    await page.reload();
    await page.waitForLoadState();
  }

  async go_back(): Promise<void> {
    /**
     * 在历史记录中后退
     */
    const page = await this.get_current_page();
    try {
      // 10毫秒超时
      await page.goBack({ timeout: 10, waitUntil: 'domcontentloaded' });
    } catch (e) {
      // 即使没有完全加载也继续，因为我们稍后会等待页面加载
      logger.debug(`During go_back: ${e}`);
    }
  }

  async go_forward(): Promise<void> {
    /**
     * 在历史记录中前进
     */
    const page = await this.get_current_page();
    try {
      await page.goForward({ timeout: 10, waitUntil: 'domcontentloaded' });
    } catch (e) {
      // 即使没有完全加载也继续，因为我们稍后会等待页面加载
      logger.debug(`During go_forward: ${e}`);
    }
  }

  async close_current_tab(): Promise<void> {
    /**
     * 关闭当前标签页
     */
    const session = await this.get_session();
    const page = await this._get_current_page(session);
    await page.close();

    // 如果存在，切换到第一个可用标签页
    if (session.context.pages().length) {
      await this.switch_to_tab(0);
    }

    // 否则浏览器将被关闭
  }

  async get_page_html(): Promise<string> {
    /**
     * 获取当前页面的HTML内容
     */
    const page = await this.get_current_page();
    return await page.content();
  }

  async execute_javascript(script: string): Promise<any> {
    /**
     * 在页面上执行JavaScript代码
     */
    const page = await this.get_current_page();
    return await page.evaluate(script);
  }

  async get_page_structure(): Promise<string> {
    /**
     * 获取页面结构的调试视图，包括iframe
     */
    const debugScript = `(() => {
        function getPageStructure(element = document, depth = 0, maxDepth = 10) {
          if (depth >= maxDepth) return '';

          const indent = '  '.repeat(depth);
          let structure = '';

          // 跳过某些会使输出混乱的元素
          const skipTags = new Set(['script', 'style', 'link', 'meta', 'noscript']);

          // 如果不是document，添加当前元素信息
          if (element !== document) {
            const tagName = element.tagName.toLowerCase();

            // 跳过不感兴趣的元素
            if (skipTags.has(tagName)) return '';

            const id = element.id ? \`#\${element.id}\` : '';
            const classes = element.className && typeof element.className === 'string' ?
              \`.\${element.className.split(' ').filter(c => c).join('.')}\` : '';

            // 获取其他有用的属性
            const attrs = [];
            if (element.getAttribute('role')) attrs.push(\`role="\${element.getAttribute('role')}"\`);
            if (element.getAttribute('aria-label')) attrs.push(\`aria-label="\${element.getAttribute('aria-label')}"\`);
            if (element.getAttribute('type')) attrs.push(\`type="\${element.getAttribute('type')}"\`);
            if (element.getAttribute('name')) attrs.push(\`name="\${element.getAttribute('name')}"\`);
            if (element.getAttribute('src')) {
              const src = element.getAttribute('src');
              attrs.push(\`src="\${src.substring(0, 50)}\${src.length > 50 ? '...' : ''}"\`);
            }

            // 添加元素信息
            structure += \`\${indent}\${tagName}\${id}\${classes}\${attrs.length ? ' [' + attrs.join(', ') + ']' : ''}\\n\`;

            // 特别处理iframe
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

          // 获取所有子元素
          const children = element.children || element.childNodes;
          for (const child of children) {
            if (child.nodeType === 1) { // 只处理元素节点
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

  @timeExecutionSync('--get_state')
  async get_state(): Promise<BrowserState> {
    /**
     * 获取浏览器的当前状态
     */
    await this._wait_for_page_and_frames_load();
    const session = await this.get_session();
    session.cached_state = await this._update_state();

    // 如果指定了文件，保存cookies
    if (this.config.cookies_file) {
      void this.save_cookies();
    }

    return session.cached_state;
  }

  async _update_state(focus_element: number = -1): Promise<BrowserState> {
    /**
     * 更新并返回状态
     */
    const session = await this.get_session();

    // 检查当前页面是否仍然有效，如果无效则切换到另一个可用页面
    try {
      const page = await this.get_current_page();
      // 测试页面是否仍然可访问
      await page.evaluate('1');
    } catch (e) {
      logger.debug(`当前页面不再可访问: ${e}`);
      // 获取所有可用页面
      const pages = session.context.pages();
      if (pages.length) {
        this.state.target_id = null;
        const page = await this._get_current_page(session);
        logger.debug(`切换到页面: ${await page.title()}`);
      } else {
        throw new BrowserError('浏览器已关闭: 没有有效的页面可用');
      }
    }

    try {
      await this.remove_highlights();
      const dom_service = new DomService(await this.get_current_page());
      const content = await dom_service.get_clickable_elements(
        this.config.highlight_elements,
        focus_element,
        this.config.viewport_expansion,
      );

      const screenshot_b64 = await this.take_screenshot();
      const [pixels_above, pixels_below] = await this.get_scroll_info(await this.get_current_page());
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
      // 如果可用，返回最后已知的良好状态
      if (this.current_state) {
        return this.current_state;
      }
      throw e;
    }
  }

  // region - 浏览器操作
  @timeExecutionAsync('--take_screenshot')
  async take_screenshot(full_page: boolean = false): Promise<string> {
    /**
     * 返回当前页面的base64编码截图
     */
    const page = await this.get_current_page();

    await page.bringToFront();
    await page.waitForLoadState();

    const screenshot = await page.screenshot({
      fullPage: full_page,
      animations: 'disabled'
    });

    const screenshot_b64 = Buffer.from(screenshot).toString('base64');

    return screenshot_b64;
  }

  @timeExecutionAsync('--remove_highlights')
  async remove_highlights(): Promise<void> {
    /**
     * 移除所有由highlightElement函数创建的高亮覆盖和标签
     * 处理页面可能已关闭或无法访问的情况
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
}
        `);
    } catch (e) {
      logger.debug(`移除高亮失败(这通常是可以的): ${e}`);
      // 不抛出错误，因为这不是关键功能
    }
  }
  // endregion

  // region - 用户操作

  static _convert_simple_xpath_to_css_selector(xpath: string): string {
    /**
     * 将简单的XPath表达式转换为CSS选择器
     */
    if (!xpath) {
      return '';
    }

    // 如果存在，移除开头的斜杠
    xpath = xpath.replace(/^\//, '');

    // 分割成部分
    const parts = xpath.split('/');
    const css_parts: string[] = [];

    for (const part of parts) {
      if (!part) {
        continue;
      }

      // 处理带冒号的自定义元素，通过转义它们
      if (part.includes(':') && !part.includes('[')) {
        const base_part = part.replace(/:/g, '\\:');
        css_parts.push(base_part);
        continue;
      }

      // 处理索引表示法 [n]
      if (part.includes('[')) {
        const base_part_end = part.indexOf('[');
        let base_part = part.substring(0, base_part_end);
        // 处理基本部分中带冒号的自定义元素
        if (base_part.includes(':')) {
          base_part = base_part.replace(/:/g, '\\:');
        }
        const index_part = part.substring(base_part_end);

        // 处理多个索引
        const indices = index_part.split(']').slice(0, -1).map(i => i.replace('[', '').trim());

        for (const idx of indices) {
          try {
            // 处理数字索引
            if (/^\d+$/.test(idx)) {
              const index = parseInt(idx) - 1;
              base_part += `:nth-of-type(${index + 1})`;
            }
            // 处理last()函数
            else if (idx === 'last()') {
              base_part += ':last-of-type';
            }
            // 处理position()函数
            else if (idx.includes('position()')) {
              if (idx.includes('>1')) {
                base_part += ':nth-of-type(n+2)';
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

    const base_selector = css_parts.join(' > ');
    return base_selector;
  }

  @timeExecutionSync('--enhanced_css_selector_for_element')
  static _enhanced_css_selector_for_element(element: DOMElementNode, include_dynamic_attributes: boolean = true): string {
    /**
     * 为DOM元素创建CSS选择器，处理各种边缘情况和特殊字符
     *
     * 参数:
     *   element: 要为其创建选择器的DOM元素
     *
     * 返回:
     *   有效的CSS选择器字符串
     */
    try {
      // 从XPath获取基本选择器
      let css_selector = this._convert_simple_xpath_to_css_selector(element.xpath);

      // 处理class属性
      if (element.attributes['class'] && include_dynamic_attributes) {
        // 定义CSS中有效类名的正则表达式模式
        const valid_class_name_pattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

        // 遍历class属性值
        const classes = element.attributes['class'].split(/\s+/);
        for (const class_name of classes) {
          // 跳过空类名
          if (!class_name.trim()) {
            continue;
          }

          // 检查类名是否有效
          if (valid_class_name_pattern.test(class_name)) {
            // 将有效类名附加到CSS选择器
            css_selector += `.${class_name}`;
          } else {
            // 跳过无效类名
            continue;
          }
        }
      }

      // 扩展的安全属性集，这些属性稳定且对选择有用
      const SAFE_ATTRIBUTES = new Set([
        // 数据属性（如果它们在您的应用程序中是稳定的）
        'id',
        // 标准HTML属性
        'name',
        'type',
        'placeholder',
        // 可访问性属性
        'aria-label',
        'aria-labelledby',
        'aria-describedby',
        'role',
        // 常见表单属性
        'for',
        'autocomplete',
        'required',
        'readonly',
        // 媒体属性
        'alt',
        'title',
        'src',
        // 自定义稳定属性（添加任何特定于应用程序的属性）
        'href',
        'target',
      ]);

      if (include_dynamic_attributes) {
        const dynamic_attributes = new Set([
          'data-id',
          'data-qa',
          'data-cy',
          'data-testid',
        ]);

        for (const attr of dynamic_attributes) {
          SAFE_ATTRIBUTES.add(attr);
        }
      }

      // 处理其他属性
      for (const [attribute, value] of Object.entries(element.attributes)) {
        if (attribute === 'class') {
          continue;
        }

        // 跳过无效的属性名
        if (!attribute.trim()) {
          continue;
        }

        if (!SAFE_ATTRIBUTES.has(attribute)) {
          continue;
        }

        // 转义属性名中的特殊字符
        const safe_attribute = attribute.replace(/:/g, '\\:');

        // 处理不同的值情况
        if (value === '') {
          css_selector += `[${safe_attribute}]`;
        } else if (/["'<>`\n\r\t]/.test(value)) {
          // 对于带有特殊字符的值使用contains
          // 正则替换*任何*空白为单个空格，然后去除两端空白
          const collapsed_value = value.replace(/\s+/g, ' ').trim();
          // 转义嵌入的双引号
          const safe_value = collapsed_value.replace(/"/g, '\\"');
          css_selector += `[${safe_attribute}*="${safe_value}"]`;
        } else {
          css_selector += `[${safe_attribute}="${value}"]`;
        }
      }

      return css_selector;
    } catch (e) {
      // 如果出现问题，回退到更基本的选择器
      const tag_name = element.tag_name || '*';
      return `${tag_name}[highlight_index='${element.highlight_index}']`;
    }
  }

  @timeExecutionAsync('--get_locate_element')
  async get_locate_element(element: DOMElementNode): Promise<ElementHandle | null> {
    let current_frame: Page | FrameLocator = await this.get_current_page();

    // 从目标元素开始，收集所有父元素
    const parents: DOMElementNode[] = [];
    let current = element;
    while (current.parent !== null) {
      const parent = current.parent;
      parents.push(parent);
      current = parent;
    }

    // 反转父元素列表，从上到下处理
    parents.reverse();

    // 按顺序处理所有iframe父元素
    const iframes = parents.filter(item => item.tag_name === 'iframe');
    for (const parent of iframes) {
      const css_selector = BrowserContext._enhanced_css_selector_for_element(
        parent,
        this.config.include_dynamic_attributes
      );
      current_frame = (current_frame as Page).frameLocator(css_selector);
    }

    const css_selector = BrowserContext._enhanced_css_selector_for_element(
      element,
      this.config.include_dynamic_attributes
    );

    try {
      if ((current_frame as FrameLocator).locator) {
        const element_handle = await current_frame.locator(css_selector).first().elementHandle();
        return element_handle;
      } else {
        // 如果隐藏则尝试滚动到视图
        const element_handle = await (current_frame as Page).locator(css_selector).first();
        if (element_handle) {
          await element_handle.scrollIntoViewIfNeeded();
          return element_handle.elementHandle();
        }
        return null;
      }
    } catch (e) {
      logger.error(`Failed to locate element: ${e.stack}`);
      return null;
    }
  }

  @timeExecutionAsync('--input_text_element_node')
  async _input_text_element_node(element_node: DOMElementNode, text: string): Promise<void> {
    /**
     * 将文本输入到元素中，具有适当的错误处理和状态管理。
     * 处理不同类型的输入字段，并确保输入前元素状态正确。
     */
    try {
      const element_handle = await this.get_locate_element(element_node);

      if (element_handle === null) {
        throw new BrowserError(`元素: ${element_node} 未找到`);
      }

      // 确保元素已准备好输入
      try {
        await element_handle.waitForElementState('stable', { timeout: 1000 });
        await element_handle.scrollIntoViewIfNeeded({ timeout: 1000 });
      } catch (e) {
        // 忽略等待错误
      }

      // 获取元素属性以确定输入方法
      const tag_handle = await element_handle.getProperty("tagName");
      const tag_name = (await tag_handle.jsonValue() as string).toLowerCase();
      const is_contenteditable = await element_handle.getProperty('isContentEditable');
      const readonly_handle = await element_handle.getProperty("readOnly");
      const disabled_handle = await element_handle.getProperty("disabled");

      const readonly = readonly_handle ? await readonly_handle.jsonValue() : false;
      const disabled = disabled_handle ? await disabled_handle.jsonValue() : false;

      if ((await is_contenteditable.jsonValue() || tag_name === 'input') && !(readonly || disabled)) {
        await element_handle.evaluate('el => el.textContent = ""');
        await element_handle.type(text, { delay: 5 });
      } else {
        await element_handle.fill(text);
      }
    } catch (e) {
      logger.error(`输入文本失败: ${e}`);
      throw new BrowserError(`输入文本失败: ${e}`);
    }
  }


  @timeExecutionAsync('--click_element_node')
  async _click_element_node(elementNode: DOMElementNode): Promise<string | null> {
    const page = await this.get_current_page();

    try {
      // Highlight before clicking
      // if (elementNode.highlightIndex !== null) {
      //   await this._updateState({ focusElement: elementNode.highlightIndex });
      // }

      const elementHandle = await this.get_locate_element(elementNode);

      if (!elementHandle) {
        throw new Error(`Element: ${elementNode.toString()} not found`);
      }

      const performClick = async (clickFunc: () => Promise<void>): Promise<string | null> => {
        if (this.config.save_downloads_path) {
          try {
            // Try short-timeout expect_download to detect a file download has been triggered
            const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
            await clickFunc();
            const download = await downloadPromise;

            // Determine file path
            const suggestedFilename = download.suggestedFilename();
            const uniqueFilename = await this._getUniqueFilename(this.config.save_downloads_path, suggestedFilename);
            const downloadPath = path.join(this.config.save_downloads_path, uniqueFilename);
            await download.saveAs(downloadPath);
            logger.debug(`Download triggered. Saved file to: ${downloadPath}`);
            return downloadPath;
          } catch (e) {
            if ((e as Error).message.includes('timeout')) {
              // If no download is triggered, treat as normal click
              logger.debug('No download triggered within timeout. Checking navigation...');
              await page.waitForLoadState();
              await this._check_and_handle_navigation(page);
            } else {
              throw e;
            }
          }
        } else {
          // Standard click logic if no download is expected
          await clickFunc();
          await page.waitForLoadState();
          await this._check_and_handle_navigation(page);
        }
        return null;
      };

      try {
        return await performClick(async () => await elementHandle.click({ timeout: 1500 }));
      } catch (e) {
        if (e instanceof URLNotAllowedError) {
          throw e;
        }
        try {
          return await performClick(async () =>
            await page.evaluate('(el) => el.click()', elementHandle)
          );
        } catch (innerE) {
          if (innerE instanceof URLNotAllowedError) {
            throw innerE;
          }
          throw new Error(`Failed to click element: ${(innerE as Error).message}`);
        }
      }
    } catch (e) {
      if (e instanceof URLNotAllowedError) {
        throw e;
      }
      throw new Error(`Failed to click element: ${elementNode.toString()}. Error: ${(e as Error).message}`);
    }
  }

  async input_text(element_index: number, text: string): Promise<void> {
    /**
     * 在指定索引的元素中输入文本
     */
    await this._wait_for_page_and_frames_load();
    const session = await this.get_session();

    if (!session.cached_state) {
      session.cached_state = await this._update_state();
    }

    const selector_map = session.cached_state.selector_map;
    if (!selector_map || !selector_map[element_index]) {
      throw new BrowserError(`元素索引 ${element_index} 不存在于选择器映射中`);
    }

    const element_node = selector_map[element_index];
    await this._input_text_element_node(element_node, text);

    // 等待页面加载
    await this._wait_for_page_and_frames_load();

    // 更新状态
    session.cached_state = await this._update_state(element_index);
  }

  async click_element(element_index: number): Promise<void> {
    /**
     * 点击指定索引的元素
     */
    await this._wait_for_page_and_frames_load();
    const session = await this.get_session();

    if (!session.cached_state) {
      session.cached_state = await this._update_state();
    }

    const selector_map = session.cached_state.selector_map;
    if (!selector_map || !selector_map[element_index]) {
      throw new BrowserError(`元素索引 ${element_index} 不存在于选择器映射中`);
    }

    const element_node = selector_map[element_index];
    await this._click_element_node(element_node);

    // 等待页面加载
    await this._wait_for_page_and_frames_load();

    // 更新状态
    session.cached_state = await this._update_state();
  }

  async click_element_by_selector(selector: string): Promise<void> {
    /**
     * 通过CSS选择器点击元素
     */
    await this._wait_for_page_and_frames_load();
    const page = await this.get_current_page();

    try {
      await page.click(selector);
    } catch (e) {
      throw new BrowserError(`通过选择器 ${selector} 点击元素失败: ${e}`);
    }

    // 等待页面加载
    await this._wait_for_page_and_frames_load();

    // 更新状态
    const session = await this.get_session();
    session.cached_state = await this._update_state();
  }

  async input_text_by_selector(selector: string, text: string): Promise<void> {
    /**
     * 通过CSS选择器在元素中输入文本
     */
    await this._wait_for_page_and_frames_load();
    const page = await this.get_current_page();

    try {
      await page.fill(selector, text);
    } catch (e) {
      throw new BrowserError(`通过选择器 ${selector} 输入文本失败: ${e}`);
    }

    // 等待页面加载
    await this._wait_for_page_and_frames_load();

    // 更新状态
    const session = await this.get_session();
    session.cached_state = await this._update_state();
  }

  async press_key(key: string): Promise<void> {
    /**
     * 按下键盘按键
     */
    await this._wait_for_page_and_frames_load();
    const page = await this.get_current_page();

    try {
      await page.keyboard.press(key);
    } catch (e) {
      throw new BrowserError(`按下键 ${key} 失败: ${e}`);
    }

    // 等待页面加载
    await this._wait_for_page_and_frames_load();

    // 更新状态
    const session = await this.get_session();
    session.cached_state = await this._update_state();
  }

  async save_cookies(): Promise<void> {
    /**
     * 保存当前会话的cookies到文件
     */
    if (!this.config.cookies_file || !this.session) {
      return;
    }

    try {
      const cookies = await this.session.context.cookies();
      const cookiesJson = JSON.stringify(cookies, null, 2);
      fs.writeFileSync(this.config.cookies_file, cookiesJson);
      logger.debug(`保存了 ${cookies.length} 个cookies到 ${this.config.cookies_file}`);
    } catch (e) {
      logger.error(`保存cookies失败: ${e}`);
    }
  }

  async _get_current_page(session: BrowserSession): Promise<Page> {
    /**
     * 获取当前活动页面
     */
    const pages = session.context.pages();
    if (!pages.length) {
      return await session.context.newPage();
    }

    // 如果有目标ID，尝试找到匹配的页面
    if (this.state.target_id && this.browser.config.cdp_url) {
      const targets = await this._get_cdp_targets();
      for (const target of targets) {
        if (target['targetId'] === this.state.target_id) {
          for (const page of pages) {
            if (page.url() === target['url']) {
              return page;
            }
          }
        }
      }
    }

    // 如果没有找到匹配的页面，使用第一个页面
    return pages[pages.length - 1];
  }

  async _get_cdp_targets(): Promise<any[]> {
    /**
     * 获取CDP目标列表
     */
    if (!this.browser.config.cdp_url) {
      return [];
    }

    try {
      const response = await fetch(`${this.browser.config.cdp_url}/json/list`);
      const targets = await response.json();
      return targets.filter((target: any) =>
        target['type'] === 'page' && !target['url'].startsWith('devtools://')
      );
    } catch (e) {
      logger.error(`获取CDP目标失败: ${e}`);
      return [];
    }
  }

  async get_tabs_info(): Promise<TabInfo[]> {
    /**
     * 获取所有标签页的信息
     */
    const session = await this.get_session();
    const pages = session.context.pages();
    const tabs: TabInfo[] = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      tabs.push({
        page_id: i,
        url: page.url(),
        title: await page.title()
      });
    }

    return tabs;
  }

  async switch_to_tab(tab_index: number): Promise<void> {
    /**
     * 切换到指定索引的标签页
     */
    const session = await this.get_session();
    const pages = session.context.pages();

    if (tab_index < 0 || tab_index >= pages.length) {
      throw new BrowserError(`无效的标签页索引: ${tab_index}, 可用标签页: ${pages.length}`);
    }

    const page = pages[tab_index];
    await page.bringToFront();

    // 更新目标ID
    if (this.browser.config.cdp_url) {
      const targets = await this._get_cdp_targets();
      for (const target of targets) {
        if (target['url'] === page.url()) {
          this.state.target_id = target['targetId'];
          break;
        }
      }
    }
  }

  async reset_context(): Promise<void> {
    // Reset the browser session
    // Call this when you don't want to kill the context but just kill the state

    // close all tabs and clear cached state
    const session = await this.get_session();

    const pages = session.context.pages();
    for (const page of pages) {
      await page.close();
    }

    session.cached_state = null;
    this.state.target_id = null;
  }

  async _getUniqueFilename(directory: string, filename: string): Promise<string> {
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
     * 获取页面滚动信息
     * 返回: [pixels_above, pixels_below]
     */
    const scrollInfo = await page.evaluate(() => {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const scrollHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight
      );
      const clientHeight = document.documentElement.clientHeight;

      return {
        pixels_above: Math.round(scrollTop),
        pixels_below: Math.round(Math.max(0, scrollHeight - clientHeight - scrollTop))
      };
    });

    return [scrollInfo.pixels_above, scrollInfo.pixels_below];
  }

  async scroll_page(direction: 'up' | 'down', amount: number = 300): Promise<void> {
    /**
     * 滚动页面
     *
     * 参数:
     *   direction: 滚动方向 ('up' 或 'down')
     *   amount: 滚动像素数
     */
    const page = await this.get_current_page();
    const scrollAmount = direction === 'up' ? -amount : amount;

    await page.evaluate((scrollY) => {
      window.scrollBy(0, scrollY);
    }, scrollAmount);

    // 等待滚动完成
    await page.waitForTimeout(100);
  }
  async get_selector_map(): Promise<SelectorMap> {
    const session = await this.get_session();
    if (session.cached_state === null) {
      return {};
    }
    return session.cached_state.selector_map;
  }

  async getElementByIndex(index: number): Promise<ElementHandle | null> {
    const selectorMap = await this.get_selector_map();
    const elementHandle = await this.get_locate_element(selectorMap[index]);
    return elementHandle;
  }

  async getDomElementByIndex(index: number): Promise<DOMElementNode> {
    const selectorMap = await this.get_selector_map();
    return selectorMap[index];
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
    if (elementNode.tag_name === 'input') {
      isUploader = elementNode.attributes.type === 'file' ||
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

  @timeExecutionAsync('--create_new_tab')
  async create_new_tab(url?: string): Promise<void> {
    // Create a new tab and optionally navigate to a URL
    if (url && !this._is_url_allowed(url)) {
      throw new BrowserError(`Cannot create new tab with non-allowed URL: ${url}`);
    }

    const session = await this.get_session();
    const newPage = await session.context.newPage();
    await newPage.waitForLoadState();

    if (url) {
      await newPage.goto(url);
      await this._wait_for_page_and_frames_load(1);
    }

    // Get target ID for new page if using CDP
    if (this.browser.config.cdpUrl) {
      const targets = await this._get_cdp_targets();
      for (const target of targets) {
        if (target['url'] === newPage.url) {
          this.state.target_id = target['targetId'];
          break;
        }
      }
    }
  }
}

export { BrowserContext, BrowserContextConfig, BrowserContextState, BrowserSession };