import { DOMState, DOMElementNode, type SelectorMap } from "../dom/views";

// Equivalent to Python's DOMHistoryElement
interface DOMHistoryElement {
  xpath: string;
}

// Pydantic model equivalent
export interface TabInfo {
  /**
   * Represents information about a browser tab
   */
  page_id: number;
  url: string;
  title: string;
}

// Dataclass equivalent
export class BrowserState extends DOMState {
  url: string;
  title: string;
  tabs: TabInfo[];
  screenshot: string | null;
  pixels_above: number;
  pixels_below: number;
  browser_errors: string[];

  constructor(data: {
    url: string,
    title: string,
    tabs: TabInfo[],
    screenshot?: string,
    pixels_above?: number,
    pixels_below?: number,
    element_tree: DOMElementNode,
    selector_map: SelectorMap,
    browser_errors?: string[],
  }) {
    super(data);
    this.url = data.url;
    this.title = data.title;
    this.tabs = data.tabs;
    this.screenshot = data.screenshot || null;
    this.pixels_above = data.pixels_above || 0;
    this.pixels_below = data.pixels_below || 0;
    this.browser_errors = data.browser_errors || [];
  }
}

// Dataclass equivalent
export class BrowserStateHistory {
  url: string = "";
  title: string = "";
  tabs: TabInfo[] = [];
  interacted_element: (DOMHistoryElement | null)[] = [];
  screenshot: string | null = null;

  constructor(data: {
    url: string,
    title: string,
    tabs: TabInfo[],
    interacted_element: (DOMHistoryElement | null)[],
    screenshot: string | null
  }
  ) {
    Object.assign(this, data);
  }

  toJSON(): Record<string, any> {
    const data: Record<string, any> = {};
    data['tabs'] = this.tabs;
    data['screenshot'] = this.screenshot;
    data['interacted_element'] = this.interacted_element.map(el =>
      el ? JSON.stringify(el) : null
    );
    data['url'] = this.url;
    data['title'] = this.title;
    return data;
  }

  static fromJSON(data: Record<string, any>): BrowserStateHistory {
    // Ensure interacted_element is parsed correctly if it was stringified
    const interacted_element = (data['interacted_element'] as (string | null)[]).map(el_str => {
      if (el_str) {
        try {
          return JSON.parse(el_str) as DOMHistoryElement;
        } catch (e) {
          console.error("Error parsing interacted_element item:", e);
          return null;
        }
      }
      return null;
    });

    return new BrowserStateHistory({
      url: data['url'] as string,
      title: data['title'] as string,
      tabs: data['tabs'] as TabInfo[],
      interacted_element: interacted_element,
      screenshot: data['screenshot'] as string | null,
    });
  }
}

// Error classes
export class BrowserError extends Error {
  /**
   * Base class for all browser errors
   */
  constructor(message?: string) {
    super(message);
    this.name = "BrowserError";
  }
}

export class URLNotAllowedError extends BrowserError {
  /**
   * Error raised when a URL is not allowed
   */
  constructor(message?: string) {
    super(message);
    this.name = "URLNotAllowedError";
  }
}
