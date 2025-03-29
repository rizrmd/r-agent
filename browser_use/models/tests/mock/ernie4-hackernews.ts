import { Content, Message } from "../../langchain";

export async function mockHackernews(messages: Message[]) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if ((messages[0].content as string).includes('Your task is to extract the content of the page.')) {
      return {
        "id": "as-ihqzwshrrs",
        "object": "chat.completion",
        "created": 1743248638,
        "model": "ernie-4.0-turbo-128k",
        "choices": [
          {
            "index": 0,
            "message": {
              "role": "assistant",
              "content": "```json\n{\n    \"titlesAndLinks\": [\n        {\n            \"title\": \"Show HN: Physical Pomodoro Timer with ESP32 and e-paper screen\",\n            \"link\": \"https://github.com/Rukenshia/pomodoro\"\n        },\n        {\n            \"title\": \"Show HN: Personal Time Tracking with Git\",\n            \"link\": \"https://doocot.sh/blog/2025/03/28/time-tracking-with-git\"\n        },\n        {\n            \"title\": \"Show HN Pianoboi – displays sheet music as you play your piano\",\n            \"link\": \"https://pianoboi.site\"\n        },\n        {\n            \"title\": \"Show HN: An Almost Free, Open Source TURN Server\",\n            \"link\": \"https://github.com/lvidgen/WebRTC/blob/master/FOSS_TURN_Server/howto.md\"\n        },\n        {\n            \"title\": \"Show HN: A web app that shows toilets near you\",\n            \"link\": \"https://www.toilette-in-der-naehe.de\"\n        }\n    ]\n}\n```"
            },
            "finish_reason": "stop",
            "flag": 0
          }
        ],
        "usage": {
          "prompt_tokens": 4472,
          "completion_tokens": 270,
          "total_tokens": 4742
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
          "id": "as-b1s9y97d3h",
          "object": "chat.completion",
          "created": 1743248619,
          "model": "ernie-4.0-turbo-128k",
          "choices": [
            {
              "index": 0,
              "message": {
                "role": "assistant",
                "content": "```json\n{\n    \"current_state\": {\n        \"evaluation_previous_goal\": \"Success - Navigated to the Hacker News 'show hn' page\",\n        \"memory\": \"I have navigated to the Hacker News 'show hn' page. Now, I need to extract the first 5 posts.\",\n        \"next_goal\": \"Extract the first 5 posts from the Hacker News 'show hn' page\"\n    },\n    \"action\": [\n        {\n            \"extract_content\": {\n                \"goal\": \"Extract the titles and links of the first 5 posts\"\n            }\n        },\n        {\n            \"done\": {\n                \"success\": true,\n                \"text\": \"I have extracted the first 5 posts from the Hacker News 'show hn' page. Here are the titles and links:\\n\\n1. Show HN: Physical Pomodoro Timer with ESP32 and e-paper screen (https://github.com/rukenshia/)\\n2. Show HN: Personal Time Tracking with Git (https://doocot.sh/)\\n3. Show HN Pianoboi – displays sheet music as you play your piano (https://pianoboi.site/)\\n4. Show HN: An Almost Free, Open Source TURN Server (https://github.com/lvidgen/)\\n5. Show HN: A web app that shows toilets near you (https://toilette-in-der-naehe.de/)\"\n            }\n        }\n    ]\n}\n```"
              },
              "finish_reason": "stop",
              "flag": 0
            }
          ],
          "usage": {
            "prompt_tokens": 4663,
            "completion_tokens": 334,
            "total_tokens": 4997
          }
        }
    }
}