import { Content, Message } from "../../langchain";

export async function mockHackernews(messages: Message[]) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if ((messages[0].content as string).includes('Your task is to extract the content of the page.')) {
      return {
        "id": "as-xrcs7mvr78",
        "object": "chat.completion",
        "created": 1743013150,
        "model": "ernie-4.0-turbo-128k",
        "choices": [
          {
            "index": 0,
            "message": {
              "role": "assistant",
              "content": "{\"current_state\": {\"evaluation_previous_goal\": \"Success - Extracted the first 5 posts\", \"memory\": \"I have extracted the first 5 posts from hackernews show hn. The task is now complete.\", \"next_goal\": \"Complete the task\"}, \"action\": [{\"done\": {\"success\": true, \"text\": \"I have successfully retrieved the first 5 posts from hackernews show hn.\"}}]}"
            },
            "finish_reason": "stop",
            "flag": 0
          }
        ],
        "usage": {
          "prompt_tokens": 9031,
          "completion_tokens": 89,
          "total_tokens": 9120
        }
      }
    }
    else if ((messages[messages.length - 1].content as string).includes('Current step: 1/')) {
        return {
            "id": "as-ahgzi2zc05",
            "object": "chat.completion",
            "created": 1743013109,
            "model": "ernie-4.0-turbo-128k",
            "choices": [
              {
                "index": 0,
                "message": {
                  "role": "assistant",
                  "content": "```json\n{\n    \"current_state\": {\n        \"evaluation_previous_goal\": \"Unknown - No previous actions to evaluate\",\n        \"memory\": \"Starting the task. Need to navigate to hackernews show hn.\",\n        \"next_goal\": \"Navigate to hackernews show hn\"\n    },\n    \"action\": [\n        {\n            \"go_to_url\": {\n                \"url\": \"https://news.ycombinator.com/show\"\n            }\n        }\n    ]\n}\n```"
                },
                "finish_reason": "stop",
                "flag": 0
              }
            ],
            "usage": {
              "prompt_tokens": 1748,
              "completion_tokens": 115,
              "total_tokens": 1863
            }
          }
    }
    else if ((messages[messages.length - 1].content as string).includes('Current step: 2/')) {
        return {
            "id": "as-7riij92p8y",
            "object": "chat.completion",
            "created": 1743013117,
            "model": "ernie-4.0-turbo-128k",
            "choices": [
              {
                "index": 0,
                "message": {
                  "role": "assistant",
                  "content": "{\"current_state\": {\"evaluation_previous_goal\": \"Success - Navigated to hackernews show hn\", \"memory\": \"I have navigated to hackernews show hn. Now I need to extract the first 5 posts.\", \"next_goal\": \"Extract the first 5 posts\"}, \"action\": [{\"extract_content\": {\"goal\": \"Extract the first 5 posts\"}}]}"
                },
                "finish_reason": "stop",
                "flag": 0
              }
            ],
            "usage": {
              "prompt_tokens": 8400,
              "completion_tokens": 81,
              "total_tokens": 8481
            }
          }
    }
    else if ((messages[messages.length - 1].content as string).includes('Current step: 3/')) {
        return {
            "id": "as-pvk1ng9kyd",
            "object": "chat.completion",
            "created": 1743013123,
            "model": "ernie-4.0-turbo-128k",
            "choices": [
              {
                "index": 0,
                "message": {
                  "role": "assistant",
                  "content": "```json\n{\n  \"posts\": [\n{\n  \"title\": \"Show HN: Debugging data, not just code: Using Claude & Cursor with Kuzu MCP\",\n  \"url\": \"https://blog.kuzudb.com/post/2025-03-23-kuzu-mcp-server/\",\n  \"points\": 4,\n  \"user\": \"laminarflow027\",\n  \"time\": \"49 minutes ago\",\n  \"comments\": 1\n},\n{\n  \"title\": \"Show HN: A website for sharing the \\\"Good, Bad, and Why\\\"s of urban spaces\",\n  \"url\": \"https://dedede.de/en\",\n  \"points\": 77,\n  \"user\": \"kappasan\",\n  \"time\": \"19 hours ago\",\n  \"comments\": 13\n},\n{\n  \"title\": \"Show HN: gRPC Gateway Alternative with Streaming and OpenAPI 3\",\n  \"url\": \"https://meshapi.github.io/grpc-api-gateway/\",\n  \"points\": 4,\n  \"user\": \"peymo\",\n  \"time\": \"4 hours ago\",\n  \"comments\": 1\n},\n{\n  \"title\": \"Show HN: Fingernotes – handwritten notes which become their own preview image\",\n  \"url\": \"https://fingernotes.com/note/97513380\",\n  \"points\": 62,\n  \"user\": \"sumolessons\",\n  \"time\": \"1 day ago\",\n  \"comments\": 19\n},\n{\n  \"title\": \"Show HN: I made a fetch client builder to make API calls simpler and safer\",\n  \"url\": \"https://github.com/L-Blondy/up-fetch\",\n  \"points\": 5,\n  \"user\": \"laurent_blondy\",\n  \"time\": \"6 hours ago\",\n  \"comments\": \"unknown (use 'discuss' as placeholder)\"\n}\n  ]\n}\n```"
                },
                "finish_reason": "stop",
                "flag": 0
              }
            ],
            "usage": {
              "prompt_tokens": 4545,
              "completion_tokens": 470,
              "total_tokens": 5015
            }
          }
    }
    else if ((messages[messages.length - 1].content as string).includes('Current step: 5/')) {
        return {}
    }
}