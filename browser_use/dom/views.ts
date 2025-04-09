import { CoordinateSet, HashedDomElement, ViewportInfo } from './history_tree_processor/view';
import { HistoryTreeProcessor } from './history_tree_processor/service';
import { timeExecutionSync } from '../utils';

export abstract class DOMBaseNode {
  is_visible: boolean;
  parent: DOMElementNode | null;

  constructor(is_visible: boolean, parent: DOMElementNode | null) {
    this.is_visible = is_visible;
    this.parent = parent;
  }
}

export class DOMTextNode extends DOMBaseNode {
  text: string;
  readonly type: string = 'TEXT_NODE';

  constructor(params: {
    text: string;
    is_visible: boolean;
    parent: DOMElementNode | null;
  }) {
    super(params.is_visible, params.parent);
    this.text = params.text;
  }

  has_parent_with_highlight_index(): boolean {
    let current = this.parent;
    while (current != null) {
      if (current.highlight_index != null) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  is_parent_in_viewport(): boolean {
    return this.parent?.is_in_viewport ?? false;
  }

  is_parent_top_element(): boolean {
    return this.parent?.is_top_element ?? false;
  }
}

export class DOMElementNode extends DOMBaseNode {
  tag_name: string;
  xpath: string;
  attributes: { [key: string]: string };
  children: DOMBaseNode[];
  is_interactive: boolean;
  is_top_element: boolean;
  is_in_viewport: boolean;
  shadow_root: boolean;
  highlight_index: number | null;
  viewport_coordinates: CoordinateSet | null;
  page_coordinates: CoordinateSet | null;
  viewport_info: ViewportInfo | null;
  private _hash?: HashedDomElement;

  constructor(params: {
    tag_name: string;
    xpath: string;
    attributes: { [key: string]: string };
    children: DOMBaseNode[];
    is_visible: boolean;
    is_interactive?: boolean;
    is_top_element?: boolean;
    is_in_viewport?: boolean;
    shadow_root?: boolean;
    highlight_index?: number | null;
    parent?: DOMElementNode;
    viewport_coordinates?: CoordinateSet;
    page_coordinates?: CoordinateSet;
    viewport_info?: ViewportInfo;
  }) {
    super(params.is_visible, params.parent || null);
    this.tag_name = params.tag_name;
    this.xpath = params.xpath;
    this.attributes = params.attributes;
    this.children = params.children;
    this.is_interactive = params.is_interactive || false;
    this.is_top_element = params.is_top_element || false;
    this.is_in_viewport = params.is_in_viewport || false;
    this.shadow_root = params.shadow_root || false;
    this.highlight_index = params.highlight_index ?? null;
    this.viewport_coordinates = params.viewport_coordinates ?? null;
    this.page_coordinates = params.page_coordinates ?? null;
    this.viewport_info = params.viewport_info ?? null;
  }

  toString(): string {
    let tag_str = `<${this.tag_name}`;

    for (const [key, value] of Object.entries(this.attributes)) {
      tag_str += ` ${key}="${value}"`;
    }
    tag_str += '>';

    const extras: string[] = [];
    if (this.is_interactive) extras.push('interactive');
    if (this.is_top_element) extras.push('top');
    if (this.shadow_root) extras.push('shadow-root');
    if (this.highlight_index != null) extras.push(`highlight:${this.highlight_index}`);
    if (this.is_in_viewport) extras.push('in-viewport');

    if (extras.length) {
      tag_str += ` [${extras.join(', ')}]`;
    }

    return tag_str;
  }

  get hash(): HashedDomElement {
    if (!this._hash) {
      this._hash = HistoryTreeProcessor.hash_dom_element(this);
    }
    return this._hash;
  }

  get_all_text_till_next_clickable_element(max_depth: number = -1): string {
    const text_parts: string[] = [];

    const collect_text = (node: DOMBaseNode, current_depth: number): void => {
      if (max_depth !== -1 && current_depth > max_depth) {
        return;
      }

      if (node instanceof DOMElementNode && node !== this && node.highlight_index != null) {
        return;
      }

      if (node instanceof DOMTextNode) {
        text_parts.push(node.text);
      } else if (node instanceof DOMElementNode) {
        node.children.forEach(child => collect_text(child, current_depth + 1));
      }
    };

    collect_text(this, 0);
    return text_parts.join('\n').trim();
  }

  @timeExecutionSync('--clickable_elements_to_string')
  clickable_elements_to_string(include_attributes?: string[]): string {
    const formatted_text: string[] = [];

    const process_node = (node: DOMBaseNode, depth: number): void => {
      if (node instanceof DOMElementNode) {
        if (node.highlight_index != null) {
          let attributes_str = '';
          const text = node.get_all_text_till_next_clickable_element();

          if (include_attributes) {
            const attributes = Array.from(new Set(
              Object.entries(node.attributes)
                .filter(([key, value]) => include_attributes.includes(key) && value !== node.tag_name)
                .map(([_, value]) => String(value))
            ));

            if (text && attributes.includes(text)) {
              attributes.splice(attributes.indexOf(text), 1);
            }
            attributes_str = attributes.join(';');
          }

          let line = `[${node.highlight_index}]<${node.tag_name} `;
          if (attributes_str) {
            line += attributes_str;
          }
          if (text) {
            if (attributes_str) {
              line += `>${text}`;
            } else {
              line += text;
            }
          }
          line += '/>';
          formatted_text.push(line);
        }

        node.children.forEach(child => process_node(child, depth + 1));
      } else if (node instanceof DOMTextNode) {
        if (!node.has_parent_with_highlight_index() && node.is_visible) {
          formatted_text.push(node.text);
        }
      }
    };

    process_node(this, 0);
    return formatted_text.join('\n');
  }

  get_file_upload_element(check_siblings: boolean = true): DOMElementNode | null {
    if (this.tag_name === 'input' && this.attributes['type'] === 'file') {
      return this;
    }

    for (const child of this.children) {
      if (child instanceof DOMElementNode) {
        const result = child.get_file_upload_element(false);
        if (result) return result;
      }
    }

    if (check_siblings && this.parent) {
      for (const sibling of this.parent.children) {
        if (sibling !== this && sibling instanceof DOMElementNode) {
          const result = sibling.get_file_upload_element(false);
          if (result) return result;
        }
      }
    }

    return null;
  }
}

export type SelectorMap = { [key: number]: DOMElementNode };

export class DOMState {
  element_tree: DOMElementNode;
  selector_map: SelectorMap;
  constructor(
    options: {
      element_tree: DOMElementNode;
      selector_map: SelectorMap;
    }
  ) {
    this.element_tree = options.element_tree;
    this.selector_map = options.selector_map;
  }
}