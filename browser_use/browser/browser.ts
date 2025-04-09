import { Page, Browser as PlaywrightBrowser } from 'playwright';
import { chromium } from 'playwright';
import { BrowserContext, BrowserContextConfig, BrowserSession } from './context';
import { timeExecutionAsync } from '../utils';
import { Logger } from '../utils';

const logger = new Logger('Browser');


interface ElectronWebViewContext {
  init: (session: BrowserSession) => Promise<void>;
  pages: (session: BrowserSession) => Promise<Page[]>;
  newPage: (session: BrowserSession, url?: string) => Promise<Page>;
}

interface BrowserConfig {
  /**
   * Configuration for the Browser.
   *
   * Default values:
   *   headless: true
   *     Whether to run browser in headless mode
   *
   *   disable_security: true
   *     Disable browser security features
   *
   *   extra_chromium_args: []
   *     Extra arguments to pass to the browser
   *
   *   wss_url: null
   *     Connect to a browser instance via WebSocket
   *
   *   cdp_url: null
   *     Connect to a browser instance via CDP
   *
   *   chrome_instance_path: null
   *     Path to a Chrome instance to use to connect to your normal browser
   *     e.g. '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
   */
  headless: boolean;
  disable_security: boolean;
  extra_chromium_args: string[];
  chrome_instance_path?: string;
  wss_url?: string;
  cdp_url?: string;
  new_context_config: BrowserContextConfig;
  force_keep_browser_alive: boolean;
  /**
   * The mode to use for the browser.
   * default: chromium
   * electron-view:
   *   - Use the Electron WebContentsView to embed the browser
   *
   * electron:
   *   - Use the Electron API to embed the browser
   *   - Requires Electron to be installed
   */
  mode?: 'chromium' | 'electron' | 'electron-view';
  electronWebviewContext?: ElectronWebViewContext;
}

const defaultBrowserConfig: BrowserConfig = {
  headless: false,
  disable_security: true,
  extra_chromium_args: [],
  chrome_instance_path: undefined,
  wss_url: undefined,
  cdp_url: undefined,
  new_context_config: new BrowserContextConfig(),
  force_keep_browser_alive: false
};

class Browser {
  config: BrowserConfig;
  private playwright_browser: PlaywrightBrowser | null = null;
  private disable_security_args: string[] = [];

  constructor(config: Partial<BrowserConfig> = {}) {
    logger.debug('Initializing new browser');
    this.config = { ...defaultBrowserConfig, ...config };

    if (this.config.disable_security) {
      this.disable_security_args = [
        '--disable-web-security',
        '--disable-site-isolation-trials',
        '--disable-features=IsolateOrigins,site-per-process',
      ];
    }
  }

  async new_context(config: BrowserContextConfig = new BrowserContextConfig()): Promise<BrowserContext> {
    return new BrowserContext(this, config);
  }

  async get_playwright_browser(): Promise<PlaywrightBrowser> {
    if (!this.playwright_browser) {
      return await this._init();
    }
    return this.playwright_browser;
  }

  @timeExecutionAsync('--init (browser)')
  private async _init(): Promise<PlaywrightBrowser> {
    const browser = await this._setup_browser();
    this.playwright_browser = browser;
    return this.playwright_browser;
  }

  private async _setup_cdp(): Promise<PlaywrightBrowser> {
    if (!this.config.cdp_url) {
      throw new Error('CDP URL is required');
    }
    logger.info(`Connecting to remote browser via CDP ${this.config.cdp_url}`);
    return await chromium.connectOverCDP(this.config.cdp_url);
  }

  private async _setup_wss(): Promise<PlaywrightBrowser> {
    if (!this.config.wss_url) {
      throw new Error('WSS URL is required');
    }
    logger.info(`Connecting to remote browser via WSS ${this.config.wss_url}`);
    return await chromium.connect(this.config.wss_url);
  }

  private async _setup_browser_with_instance(): Promise<PlaywrightBrowser> {
    if (!this.config.chrome_instance_path) {
      throw new Error('Chrome instance path is required');
    }

    const { spawn } = require('child_process');

    try {
      // Check if browser is already running
      const response = await fetch('http://localhost:9222/json/version');
      if (response.ok) {
        logger.info('Reusing existing Chrome instance');
        return await chromium.connectOverCDP({
          endpointURL: 'http://localhost:9222',
          timeout: 20000,
        });
      }
    } catch (error) {
      logger.debug('No existing Chrome instance found, starting a new one');
    }

    // Start a new Chrome instance
    spawn(
      this.config.chrome_instance_path,
      ['--remote-debugging-port=9222', ...this.config.extra_chromium_args],
      { stdio: 'ignore' }
    );

    // Wait for Chrome to start
    for (let i = 0; i < 10; i++) {
      try {
        const response = await fetch('http://localhost:9222/json/version');
        if (response.ok) break;
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    try {
      return await chromium.connectOverCDP({
        endpointURL: 'http://localhost:9222',
        timeout: 20000,
      });
    } catch (error) {
      logger.error(`Failed to start a new Chrome instance: ${error}`);
      throw new Error(
        'To start chrome in Debug mode, you need to close all existing Chrome instances and try again otherwise we can not connect to the instance.'
      );
    }
  }

  private async _setup_standard_browser(): Promise<PlaywrightBrowser> {
    return await chromium.launch({
      headless: this.config.headless,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--disable-background-timer-throttling',
        '--disable-popup-blocking',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-window-activation',
        '--disable-focus-on-load',
        '--no-first-run',
        '--no-default-browser-check',
        '--no-startup-window',
        '--window-position=0,0',
        ...this.disable_security_args,
        ...this.config.extra_chromium_args,
      ],
    });
  }

  private async _setup_browser(): Promise<PlaywrightBrowser> {
    try {
      if (this.config.cdp_url) {
        return await this._setup_cdp();
      }
      if (this.config.wss_url) {
        return await this._setup_wss();
      }
      if (this.config.chrome_instance_path) {
        return await this._setup_browser_with_instance();
      }
      return await this._setup_standard_browser();
    } catch (error) {
      logger.error(`Failed to initialize Playwright browser: ${error}`);
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      if (!this.config.force_keep_browser_alive) {
        if (this.playwright_browser) {
          await this.playwright_browser.close();
          this.playwright_browser = null;
        }
      }
    } catch (error) {
      logger.debug(`Failed to close browser properly: ${error}`);
    } finally {
      this.playwright_browser = null;
      global.gc?.();
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

export { Browser, BrowserConfig };