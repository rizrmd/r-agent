export interface Coordinates {
  x: number;
  y: number;
}

export interface HashedDomElement {
  branch_path_hash: string;
  attributes_hash: string;
  xpath_hash: string;
}

export interface CoordinateSet {
  top_left: Coordinates;
  top_right: Coordinates;
  bottom_left: Coordinates;
  bottom_right: Coordinates;
  center: Coordinates;
  width: number;
  height: number;
}

export interface ViewportInfo {
  scroll_x?: number;
  scroll_y?: number;
  width: number;
  height: number;
}

export class DOMHistoryElement {
  tag_name: string;
  xpath: string;
  highlight_index: number | null;
  entire_parent_branch_path: string[];
  attributes: Record<string, string>;
  shadow_root: boolean;
  css_selector: string | null;
  page_coordinates: CoordinateSet | null;
  viewport_coordinates: CoordinateSet | null;
  viewport_info: ViewportInfo | null;

  constructor(data: {
    tag_name: string,
    xpath: string,
    highlight_index: number | null,
    entire_parent_branch_path: string[],
    attributes: Record<string, string>,
    shadow_root?: boolean,
    css_selector?: string | null,
    page_coordinates?: CoordinateSet | null,
    viewport_coordinates?: CoordinateSet | null,
    viewport_info?: ViewportInfo | null
  }) {
    this.tag_name = data.tag_name;
    this.xpath = data.xpath;
    this.highlight_index = data.highlight_index;
    this.entire_parent_branch_path = data.entire_parent_branch_path;
    this.attributes = data.attributes;
    this.shadow_root = data.shadow_root || false;
    this.css_selector = data.css_selector || null;
    this.page_coordinates = data.page_coordinates || null;
    this.viewport_coordinates = data.viewport_coordinates || null;
    this.viewport_info = data.viewport_info || null;
  }

  toDict(): Record<string, any> {
    const page_coordinates = this.page_coordinates ? this.page_coordinates : null;
    const viewport_coordinates = this.viewport_coordinates ? this.viewport_coordinates : null;
    const viewport_info = this.viewport_info ? this.viewport_info : null;

    return {
      tag_name: this.tag_name,
      xpath: this.xpath,
      highlight_index: this.highlight_index,
      entire_parent_branch_path: this.entire_parent_branch_path,
      attributes: this.attributes,
      shadow_root: this.shadow_root,
      css_selector: this.css_selector,
      page_coordinates: page_coordinates,
      viewport_coordinates: viewport_coordinates,
      viewport_info: viewport_info,
    };
  }
}