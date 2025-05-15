import type { Page } from 'patchright';
import * as fs from 'fs';
import * as path from 'path';
import { DOMBaseNode, DOMElementNode, DOMState, DOMTextNode, SelectorMap } from './views';
import { timeExecutionAsync } from '../utils';
import { Logger } from '../utils';
import { ViewportInfo } from './history_tree_processor/view';

const logger = new Logger('DomService');

interface EvalPageResult extends Record<string, any> {
}

export class DomService {
  private page: Page;
  private xpath_cache: { [key: string]: any } = {};
  private js_code: string;

  constructor(page: Page) {
    this.page = page;
    this.js_code = fs.readFileSync(
      path.join(__dirname, 'buildDomTree.js'),
      'utf8'
    );
  }

  @timeExecutionAsync('--get_clickable_elements')
  async get_clickable_elements(
    highlight_elements: boolean = true,
    focus_element: number = -1,
    viewport_expansion: number = 0
  ): Promise<DOMState> {
    const [element_tree, selector_map] = await this._build_dom_tree(
      highlight_elements,
      focus_element,
      viewport_expansion
    );
    return new DOMState({ element_tree, selector_map });
  }

  @timeExecutionAsync('--build_dom_tree')
  private async _build_dom_tree(
    highlight_elements: boolean,
    focus_element: number,
    viewport_expansion: number
  ): Promise<[DOMElementNode, SelectorMap]> {
    if (await this.page.evaluate('1+1') !== 2) {
      throw new Error('The page cannot evaluate javascript code properly');
    }

    const debug_mode = logger.isDebugEnabled();
    const args = {
      doHighlightElements: highlight_elements,
      focusHighlightIndex: focus_element,
      viewportExpansion: viewport_expansion,
      debugMode: debug_mode,
    };

    let eval_page: EvalPageResult;
    try {
      eval_page = await this.page.evaluate<EvalPageResult>(`(${this.js_code.trim()})(${JSON.stringify(args)})`);
    } catch (e) {
      logger.error(`Error evaluating JavaScript: ${e}`);
      throw e;
    }

    if (debug_mode && eval_page.perfMetrics) {
      logger.debug(
        'DOM Tree Building Performance Metrics:\n' +
        JSON.stringify(eval_page.perfMetrics)
      );
    }

    return await this._construct_dom_tree(eval_page);
  }

  @timeExecutionAsync('--construct_dom_tree')
  private async _construct_dom_tree(
    eval_page: EvalPageResult
  ): Promise<[DOMElementNode, SelectorMap]> {

    if (!eval_page || typeof eval_page !== 'object') {
      const errorMsg = 'Failed to construct DOM tree: eval_page result is invalid or undefined.';
      logger.error(errorMsg, { eval_page_type: typeof eval_page, eval_page_value: String(eval_page).substring(0,100) });
      throw new Error(errorMsg);
    }
    if (!eval_page.map || typeof eval_page.map !== 'object') {
      const errorMsg = 'Failed to construct DOM tree: eval_page.map is invalid or undefined.';
      logger.error(errorMsg, { map_type: typeof eval_page.map });
      throw new Error(errorMsg);
    }
    if (typeof eval_page.rootId === 'undefined' || eval_page.rootId === null) {
      const errorMsg = 'Failed to construct DOM tree: eval_page.rootId is undefined or null.';
      logger.error(errorMsg, { rootId_type: typeof eval_page.rootId, rootId_value: eval_page.rootId });
      throw new Error(errorMsg);
    }

    const js_node_map = eval_page.map;
    const js_root_id = eval_page.rootId;

    const selector_map: SelectorMap = {};
    const node_map: { [key: string]: DOMBaseNode } = {};

    for (const [id, node_data] of Object.entries(js_node_map)) {
      const [node, children_ids] = this._parse_node(node_data);
      if (!node) continue;

      node_map[id] = node;

      if (node instanceof DOMElementNode && node.highlight_index != null) {
        selector_map[node.highlight_index!] = node;
      }

      if (node instanceof DOMElementNode) {
        for (const child_id of children_ids) {
          if (!(child_id in node_map)) continue;

          const child_node = node_map[child_id];
          if (child_node) { // Added check for undefined child_node
            child_node.parent = node;
            node.children.push(child_node);
          }
        }
      }
    }

    const html_to_dict = node_map[String(js_root_id)];

    // Clean up references
    Object.keys(node_map).forEach(key => delete node_map[key]);
    global.gc?.();

    if (!html_to_dict) {
      const errorMsg = `Failed to parse HTML to dictionary: Root node with ID '${js_root_id}' not found in the constructed node_map. This might indicate an issue with the page content, the DOM extraction script (buildDomTree.js), or that the page was not fully loaded.`;
      logger.error(errorMsg, { js_root_id, node_map_keys_sample: Object.keys(node_map).slice(0, 10) });
      throw new Error(errorMsg);
    }
    if (!(html_to_dict instanceof DOMElementNode)) {
      const errorMsg = `Failed to parse HTML to dictionary: Node with ID '${js_root_id}' was found but is not a DOMElementNode (actual type: ${html_to_dict?.constructor?.name}). This might indicate an issue with the page content or the DOM extraction script.`;
      logger.error(errorMsg, { js_root_id, node_type: html_to_dict?.constructor?.name });
      throw new Error(errorMsg);
    }

    return [html_to_dict, selector_map];
  }

  private _parse_node(
    node_data: any
  ): [DOMBaseNode | null, number[]] {
    if (!node_data) {
      return [null, []];
    }

    // Process text nodes
    if (node_data.type === 'TEXT_NODE') {
      const text_node = new DOMTextNode({
        text: node_data.text,
        is_visible: node_data.isVisible,
        parent: null,
      });
      return [text_node, []];
    }

    // Process viewport info if exists
    let viewport_info: ViewportInfo | undefined;
    if (node_data.viewport) {
      viewport_info = {
        width: node_data.viewport.width,
        height: node_data.viewport.height,
      };
    }

    // Process element nodes
    const element_node = new DOMElementNode({
      tag_name: node_data.tagName,
      xpath: node_data.xpath,
      attributes: node_data.attributes || {},
      children: [],
      is_visible: node_data.isVisible ?? false,
      is_interactive: node_data.isInteractive ?? false,
      is_top_element: node_data.isTopElement ?? false,
      is_in_viewport: node_data.isInViewport ?? false,
      highlight_index: node_data.highlightIndex ?? null,
      shadow_root: node_data.shadowRoot ?? false,
      viewport_info: viewport_info,
    });

    const children_ids = node_data.children || [];

    return [element_node, children_ids];
  }
}
