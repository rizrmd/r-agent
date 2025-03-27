import { Content, Message } from "../../langchain";

export async function mockHackernews(messages: Message[]) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if ((messages[0].content as string).includes('Your task is to extract the content of the page.')) {
      return {
        "id": "chatcmpl-BClDO1w404ALmxhVl6nDxG0jSkI7p",
        "object": "chat.completion",
        "created": 1742381130,
        "model": "gpt-4o-2024-08-06",
        "choices": [
          {
            "index": 0,
            "message": {
              "role": "assistant",
              "content": "```json\n{\n  \"posts\": [\n    {\n      \"title\": \"Show HN: I made a tool to port tweets to Bluesky mantaining their original date\",\n      \"link\": \"https://bluemigrate.com\"\n    },\n    {\n      \"title\": \"Show HN: \\\"Git who\\\" – A new CLI tool for industrial-scale Git blaming\",\n      \"link\": \"https://github.com/sinclairtarget/git-who\"\n    },\n    {\n      \"title\": \"Show HN: I made a live multiplayer Minesweeper game\",\n      \"link\": \"https://www.minesweeperpro.com/\"\n    },\n    {\n      \"title\": \"Show HN: I converted my notebook into a searchable database of IT keywords\",\n      \"link\": \"https://techbook.digital/\"\n    },\n    {\n      \"title\": \"Show HN: An instant short video generator\",\n      \"link\": \"https://instavidai.app\"\n    }\n  ]\n}\n```",
              "refusal": null
            },
            "logprobs": null,
            "finish_reason": "stop"
          }
        ],
        "usage": {
          "prompt_tokens": 3306,
          "completion_tokens": 205,
          "total_tokens": 3511,
          "prompt_tokens_details": {
            "cached_tokens": 0,
            "audio_tokens": 0
          },
          "completion_tokens_details": {
            "reasoning_tokens": 0,
            "audio_tokens": 0,
            "accepted_prediction_tokens": 0,
            "rejected_prediction_tokens": 0
          }
        },
        "system_fingerprint": "fp_ded0d14823"
      }
    }
    else if ((messages[messages.length - 1].content as Content[])?.[0].text.includes('Current step: 1/')) {
        return {
            "id": "chatcmpl-BClD6ePcqLOSORm7KmjQAyV6bovtl",
            "object": "chat.completion",
            "created": 1742381112,
            "model": "gpt-4o-2024-08-06",
            "choices": [
              {
                "index": 0,
                "message": {
                  "role": "assistant",
                  "content": "",
                  "tool_calls": [
                    {
                      "id": "call_mMUutc5HXiYo8AGdRe379iSH",
                      "type": "function",
                      "function": {
                        "name": "AgentOutput",
                        "arguments": "{\"current_state\":{\"evaluation_previous_goal\":\"Failed - The current page is blank with no interactive elements or information.\",\"memory\":\"The browser has started, but the current page is blank. I am tasked to extract the first 5 posts from Hacker News Show HN.\",\"next_goal\":\"Open Hacker News website in a new tab to locate the Show HN section.\"},\"action\":[{\"open_tab\":{\"url\":\"https://news.ycombinator.com/\"}}]}"
                      }
                    }
                  ],
                  "refusal": null
                },
                "logprobs": null,
                "finish_reason": "stop"
              }
            ],
            "usage": {
              "prompt_tokens": 2712,
              "completion_tokens": 92,
              "total_tokens": 2804,
              "prompt_tokens_details": {
                "cached_tokens": 0,
                "audio_tokens": 0
              },
              "completion_tokens_details": {
                "reasoning_tokens": 0,
                "audio_tokens": 0,
                "accepted_prediction_tokens": 0,
                "rejected_prediction_tokens": 0
              }
            },
            "system_fingerprint": "fp_b705f0c291"
          }
    }
    else if ((messages[messages.length - 1].content as Content[])[0].text.includes('Current step: 2/')) {
        return {
            "id": "chatcmpl-BClDF4bZRcP7M4i5SLWMspC2G5Pv0",
            "object": "chat.completion",
            "created": 1742381121,
            "model": "gpt-4o-2024-08-06",
            "choices": [
              {
                "index": 0,
                "message": {
                  "role": "assistant",
                  "content": "",
                  "tool_calls": [
                    {
                      "id": "call_YD8WFQFiBzvOO04Le773aVDV",
                      "type": "function",
                      "function": {
                        "name": "AgentOutput",
                        "arguments": "{\"current_state\":{\"evaluation_previous_goal\":\"Success - The Hacker News website is opened and the Show HN link is visible.\",\"memory\":\"The Hacker News homepage is open. Ready to navigate to the Show HN section.\",\"next_goal\":\"Click the 'show' section to go to Show HN.\"},\"action\":[{\"click_element\":{\"index\":7}}]}"
                      }
                    }
                  ],
                  "refusal": null
                },
                "logprobs": null,
                "finish_reason": "stop"
              }
            ],
            "usage": {
              "prompt_tokens": 5235,
              "completion_tokens": 72,
              "total_tokens": 5307,
              "prompt_tokens_details": {
                "cached_tokens": 0,
                "audio_tokens": 0
              },
              "completion_tokens_details": {
                "reasoning_tokens": 0,
                "audio_tokens": 0,
                "accepted_prediction_tokens": 0,
                "rejected_prediction_tokens": 0
              }
            },
            "system_fingerprint": "fp_b705f0c291"
          }
    }
    else if ((messages[messages.length - 1].content as Content[])[0].text.includes('Current step: 3/')) {
        return {
            "id": "chatcmpl-BClDLg09woZAJjWTcxJs8sdI2McEZ",
            "object": "chat.completion",
            "created": 1742381127,
            "model": "gpt-4o-2024-08-06",
            "choices": [
              {
                "index": 0,
                "message": {
                  "role": "assistant",
                  "content": "",
                  "tool_calls": [
                    {
                      "id": "call_jnOB9LKWdBvVB1ShTATourdF",
                      "type": "function",
                      "function": {
                        "name": "AgentOutput",
                        "arguments": "{\"current_state\":{\"evaluation_previous_goal\":\"Success - Navigated to Show HN, and the first five posts are visible.\",\"memory\":\"The current URL is https://news.ycombinator.com/show. First 5 posts from Show HN need extraction.\",\"next_goal\":\"Extract the titles and links of the first 5 Show HN posts.\"},\"action\":[{\"extract_content\":{\"goal\":\"Extract the titles and links of the first 5 Show HN posts.\"}}]}"
                      }
                    }
                  ],
                  "refusal": null
                },
                "logprobs": null,
                "finish_reason": "stop"
              }
            ],
            "usage": {
              "prompt_tokens": 5289,
              "completion_tokens": 96,
              "total_tokens": 5385,
              "prompt_tokens_details": {
                "cached_tokens": 0,
                "audio_tokens": 0
              },
              "completion_tokens_details": {
                "reasoning_tokens": 0,
                "audio_tokens": 0,
                "accepted_prediction_tokens": 0,
                "rejected_prediction_tokens": 0
              }
            },
            "system_fingerprint": "fp_b705f0c291"
          }
    }
    else if ((messages[messages.length - 1].content as Content[])[0].text.includes('Current step: 4/')) {
        return {
            "id": "chatcmpl-BClDXciWDHBZwnnsqZeLkxsQM17fQ",
            "object": "chat.completion",
            "created": 1742381139,
            "model": "gpt-4o-2024-08-06",
            "choices": [
              {
                "index": 0,
                "message": {
                  "role": "assistant",
                  "content": "",
                  "tool_calls": [
                    {
                      "id": "call_njmzeTQ9lcC3yZXqCeBD29od",
                      "type": "function",
                      "function": {
                        "name": "AgentOutput",
                        "arguments": "{\"current_state\":{\"evaluation_previous_goal\":\"Success - Extracted the first 5 posts from Show HN.\",\"memory\":\"Successfully extracted the first 5 Show HN posts from Hacker News. Task complete.\",\"next_goal\":\"Complete the task by returning the extracted information.\"},\"action\":[{\"done\":{\"success\":true,\"text\":\"The first 5 posts from Show HN on Hacker News have been extracted:\\n1. Show HN: I made a tool to port tweets to Bluesky maintaining their original date (Link: https://bluemigrate.com)\\n2. Show HN: \\\"Git who\\\" – A new CLI tool for industrial-scale Git blaming (Link: https://github.com/sinclairtarget/git-who)\\n3. Show HN: I made a live multiplayer Minesweeper game (Link: https://www.minesweeperpro.com/)\\n4. Show HN: I converted my notebook into a searchable database of IT keywords (Link: https://techbook.digital/)\\n5. Show HN: An instant short video generator (Link: https://instavidai.app)\"}}]}"
                      }
                    }
                  ],
                  "refusal": null
                },
                "logprobs": null,
                "finish_reason": "stop"
              }
            ],
            "usage": {
              "prompt_tokens": 5623,
              "completion_tokens": 230,
              "total_tokens": 5853,
              "prompt_tokens_details": {
                "cached_tokens": 2048,
                "audio_tokens": 0
              },
              "completion_tokens_details": {
                "reasoning_tokens": 0,
                "audio_tokens": 0,
                "accepted_prediction_tokens": 0,
                "rejected_prediction_tokens": 0
              }
            },
            "system_fingerprint": "fp_b705f0c291"
          }
    }
    else if ((messages[messages.length - 1].content as Content[])[0].text.includes('Current step: 5/')) {
        return {}
    }
}