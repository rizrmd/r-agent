import { createHash } from 'crypto';
import { DOMHistoryElement, HashedDomElement } from './view';
import { DOMElementNode } from '../views';
import { BrowserContext } from '../../browser/context';

export { DOMElementNode } from '../views';
export { DOMHistoryElement } from './view';

function isHashDomHistorySame(
  a: HashedDomElement,
  b: HashedDomElement
): boolean {
  return a.branch_path_hash === b.branch_path_hash &&
    a.attributes_hash === b.attributes_hash &&
    a.xpath_hash === b.xpath_hash;
}
export class HistoryTreeProcessor {
  /**
   * Operations on the DOM elements
   */

  static convert_dom_element_to_history_element(dom_element: DOMElementNode): DOMHistoryElement {
    const parent_branch_path = HistoryTreeProcessor._get_parent_branch_path(dom_element);
    const css_selector = BrowserContext._enhanced_css_selector_for_element(dom_element);

    return new DOMHistoryElement({
      tag_name: dom_element.tag_name,
      xpath: dom_element.xpath,
      highlight_index: dom_element.highlight_index,
      entire_parent_branch_path: parent_branch_path,
      attributes: dom_element.attributes,
      shadow_root: dom_element.shadow_root,
      css_selector,
      page_coordinates: dom_element.page_coordinates,
      viewport_coordinates: dom_element.viewport_coordinates,
      viewport_info: dom_element.viewport_info
    });
  }

  static find_history_element_in_tree(
    dom_history_element: DOMHistoryElement,
    tree: DOMElementNode
  ): DOMElementNode | null {
    const hashed_dom_history_element = HistoryTreeProcessor._hash_dom_history_element(dom_history_element);

    const process_node = (node: DOMElementNode): DOMElementNode | null => {
      if (node.highlight_index !== null) {
        const hashed_node = HistoryTreeProcessor._hash_dom_element(node);
        if (isHashDomHistorySame(hashed_node, hashed_dom_history_element)) {
          return node;
        }
      }

      for (const child of node.children) {
        if (child instanceof DOMElementNode) {
          const result = process_node(child);
          if (result !== null) {
            return result;
          }
        }
      }
      return null;
    };

    return process_node(tree);
  }

  static compare_history_element_and_dom_element(
    dom_history_element: DOMHistoryElement,
    dom_element: DOMElementNode
  ): boolean {
    const hashed_dom_history_element = HistoryTreeProcessor._hash_dom_history_element(dom_history_element);
    const hashed_dom_element = HistoryTreeProcessor._hash_dom_element(dom_element);

    return isHashDomHistorySame(hashed_dom_history_element, hashed_dom_element);
  }

  static _hash_dom_history_element(dom_history_element: DOMHistoryElement): HashedDomElement {
    const branch_path_hash = HistoryTreeProcessor._parent_branch_path_hash(
      dom_history_element.entire_parent_branch_path
    );
    const attributes_hash = HistoryTreeProcessor._attributes_hash(dom_history_element.attributes);
    const xpath_hash = HistoryTreeProcessor._xpath_hash(dom_history_element.xpath);

    return { branch_path_hash, attributes_hash, xpath_hash };
  }

  static _hash_dom_element(dom_element: DOMElementNode): HashedDomElement {
    const parent_branch_path = HistoryTreeProcessor._get_parent_branch_path(dom_element);
    const branch_path_hash = HistoryTreeProcessor._parent_branch_path_hash(parent_branch_path);
    const attributes_hash = HistoryTreeProcessor._attributes_hash(dom_element.attributes);
    const xpath_hash = HistoryTreeProcessor._xpath_hash(dom_element.xpath);

    return { branch_path_hash, attributes_hash, xpath_hash };
  }

  static _get_parent_branch_path(dom_element: DOMElementNode): string[] {
    const parents: DOMElementNode[] = [];
    let current_element: DOMElementNode | null = dom_element;

    while (current_element.parent !== null) {
      parents.push(current_element);
      current_element = current_element.parent;
    }

    parents.reverse();
    return parents.map(parent => parent.tag_name);
  }

  static _parent_branch_path_hash(parent_branch_path: string[]): string {
    const parent_branch_path_string = parent_branch_path.join('/');
    return createHash('sha256').update(parent_branch_path_string).digest('hex');
  }

  static _attributes_hash(attributes: { [key: string]: string }): string {
    const attributes_string = Object.entries(attributes)
      .map(([key, value]) => `${key}=${value}`)
      .join('');
    return createHash('sha256').update(attributes_string).digest('hex');
  }

  static _xpath_hash(xpath: string): string {
    return createHash('sha256').update(xpath).digest('hex');
  }

  static _text_hash(dom_element: DOMElementNode): string {
    const text_string = dom_element.get_all_text_till_next_clickable_element();
    return createHash('sha256').update(text_string).digest('hex');
  }
}