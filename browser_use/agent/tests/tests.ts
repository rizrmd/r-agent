import {
  AgentHistory,
  AgentHistoryList,
} from '../views';
import {
  BrowserState,
  BrowserStateHistory,
} from '../../browser/views';
import { Registry } from '../../controller/registry/service';
import {
  ClickElementAction,
  DoneAction,
  ExtractPageContentAction
} from '../../controller/views';
import { DOMElementNode } from '../../dom/views';
import z from 'zod';
import { ActionRegistry } from '../../controller/registry/views';
describe('Agent Tests', () => {
  let sampleBrowserState: BrowserState;
  let actionRegistry: ActionRegistry;
  let sampleHistory: AgentHistoryList;

  beforeEach(() => {
    // Sample browser state setup
    sampleBrowserState = new BrowserState({
      url: 'https://example.com',
      title: 'Example Page',
      tabs: [{
        url: 'https://example.com',
        title: 'Example Page',
        page_id: 1
      }],
      screenshot: 'screenshot1.png',
      element_tree: new DOMElementNode({
        tag_name: 'root',
        is_visible: true,
        parent: undefined,
        xpath: '',
        attributes: {},
        children: []
      }),
      selector_map: {}
    });

    // Action registry setup
    const registry = new Registry();

    registry.action({
      name: 'click_element',
      description: 'Click an element',
      paramsSchema: ClickElementAction,
      func: async (params: z.infer<typeof ClickElementAction>) => { }
    });

    registry.action({
      name: 'extract_page_content',
      description: 'Extract page content',
      paramsSchema: ExtractPageContentAction,
      func: async (params: z.infer<typeof ExtractPageContentAction>) => { }
    });

    registry.action({
      name: 'done',
      description: 'Mark task as done',
      paramsSchema: DoneAction,
      func: async (params: z.infer<typeof DoneAction>) => { }
    });

    // Sample history setup
    const clickAction = { click_element: { index: 1 } }
    const extractAction = { extract_page_content: { value: 'text' } }
    const doneAction = { done: { text: 'Task completed' } }

    const histories = [
      new AgentHistory({
        model_output: {
          current_state: {
            evaluation_previous_goal: 'None',
            memory: 'Started task',
            next_goal: 'Click button'
          },
          action: [clickAction]
        },
        result: [{ is_done: false }],
        state: new BrowserStateHistory({
          url: 'https://example.com',
          title: 'Page 1',
          tabs: [{
            url: 'https://example.com',
            title: 'Page 1',
            page_id: 1
          }],
          screenshot: 'screenshot1.png',
          interacted_element: [{ xpath: '//button[1]' }]
        })
      }),
      new AgentHistory({
        model_output: {
          current_state: {
            evaluation_previous_goal: 'Clicked button',
            memory: 'Button clicked',
            next_goal: 'Extract content'
          },
          action: [extractAction]
        },
        result: [{
          is_done: false,
          extracted_content: 'Extracted text',
          error: 'Failed to extract completely'
        }],
        state: new BrowserStateHistory({
          url: 'https://example.com/page2',
          title: 'Page 2',
          tabs: [{
            url: 'https://example.com/page2',
            title: 'Page 2',
            page_id: 2
          }],
          screenshot: 'screenshot2.png',
          interacted_element: [{ xpath: '//div[1]' }]
        })
      }),
      new AgentHistory({
        model_output: {
          current_state: {
            evaluation_previous_goal: 'Extracted content',
            memory: 'Content extracted',
            next_goal: 'Finish task'
          },
          action: [doneAction]
        },
        result: [{
          is_done: true,
          extracted_content: 'Task completed',
          error: null
        }],
        state: new BrowserStateHistory({
          url: 'https://example.com/page2',
          title: 'Page 2',
          tabs: [{
            url: 'https://example.com/page2',
            title: 'Page 2',
            page_id: 2
          }],
          screenshot: 'screenshot3.png',
          interacted_element: [{ xpath: '//div[1]' }]
        })
      })
    ];
    sampleHistory = new AgentHistoryList({ history: histories });
  });

  it('should get last model output', () => {
    const lastOutput = sampleHistory.last_action();
    expect(lastOutput).toEqual({ done: { text: 'Task completed' } });
  });

  it('should get errors', () => {
    const errors = sampleHistory.errors();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find(i => i?.includes('Failed'))).toBe('Failed to extract completely');
  });

  it('should get final result', () => {
    expect(sampleHistory.final_result()).toBe('Task completed');
  });

  it('should check if done', () => {
    expect(sampleHistory.is_done()).toBe(true);
  });

  it('should get urls', () => {
    const urls = sampleHistory.urls();
    expect(urls).toContain('https://example.com');
    expect(urls).toContain('https://example.com/page2');
  });

  it('should get all screenshots', () => {
    const screenshots = sampleHistory.screenshots();
    expect(screenshots).toHaveLength(3);
    expect(screenshots).toEqual([
      'screenshot1.png',
      'screenshot2.png',
      'screenshot3.png'
    ]);
  });

  // it('should get all model outputs', () => {
  //   const outputs = sampleHistory.model_actions();
  //   expect(outputs).toHaveLength(3);
  //   expect(outputs[0]).toEqual({ click_element: { index: 1 } });
  //   expect(outputs[1]).toEqual({ extract_page_content: { value: 'text' } });
  //   expect(outputs[2]).toEqual({ done: { text: 'Task completed' } });
  // });

  it('should get filtered model outputs', () => {
    const filtered = sampleHistory.model_actions_filtered(['click_element']);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].click_element.index).toBe(1);
  });

  it('should handle empty history', () => {
    const emptyHistory = new AgentHistoryList({ history: [] });
    expect(emptyHistory.last_action()).toBeNull();
    expect(emptyHistory.final_result()).toBeNull();
    expect(emptyHistory.is_done()).toBe(false);
    expect(emptyHistory.urls()).toHaveLength(0);
  });

});