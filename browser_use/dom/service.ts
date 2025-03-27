import { Page } from 'playwright';
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
        JSON.stringify(eval_page.perfMetrics, null, 2)
      );
    }

    return await this._construct_dom_tree(eval_page);
  }

  @timeExecutionAsync('--construct_dom_tree')
  private async _construct_dom_tree(
    eval_page: EvalPageResult
  ): Promise<[DOMElementNode, SelectorMap]> {

    const js_node_map = eval_page.map;
    const js_root_id = eval_page.rootId;

    const selector_map: SelectorMap = {};
    const node_map: { [key: string]: DOMBaseNode } = {};

    for (const [id, node_data] of Object.entries(js_node_map)) {
      const [node, children_ids] = this._parse_node(node_data);
      if (!node) continue;

      node_map[id] = node;

      if (node instanceof DOMElementNode && node.highlight_index !== undefined) {
        selector_map[node.highlight_index!] = node;
      }

      if (node instanceof DOMElementNode) {
        for (const child_id of children_ids) {
          if (!(child_id in node_map)) continue;

          const child_node = node_map[child_id];
          child_node.parent = node;
          node.children.push(child_node);
        }
      }
    }

    const html_to_dict = node_map[js_root_id];

    // Clean up references
    Object.keys(node_map).forEach(key => delete node_map[key]);
    global.gc?.();

    if (!html_to_dict || !(html_to_dict instanceof DOMElementNode)) {
      throw new Error('Failed to parse HTML to dictionary');
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
      highlight_index: node_data.highlightIndex,
      shadow_root: node_data.shadowRoot ?? false,
      viewport_info: viewport_info,
    });

    const children_ids = node_data.children || [];

    return [element_node, children_ids];
  }
}