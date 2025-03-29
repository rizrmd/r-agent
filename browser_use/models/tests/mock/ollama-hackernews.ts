import { Content, Message } from "../../langchain";

export async function mockHackernews(messages: Message[]) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if ((messages[0].content as string).includes('Your task is to extract the content of the page.')) {
      return {
        "model": "qwen2.5:32b",
        "created_at": "2025-03-29T11:26:24.7057915Z",
        "message": {
          "role": "assistant",
          "content": "```json\n{\n  \"posts\": [\n    {\n      \"title\": \"Show HN: Physical Pomodoro Timer with ESP32 and e-paper screen\",\n      \"url\": \"https://github.com/Rukenshia/pomodoro\",\n      \"points\": 2,\n      \"by\": \"rukenshia\",\n      \"time_ago\": \"41 minutes ago\"\n    },\n    {\n      \"title\": \"Show HN Pianoboi – displays sheet music as you play your piano\",\n      \"url\": \"https://pianoboi.site\",\n      \"points\": 41,\n      \"by\": \"bcowde\",\n      \"time_ago\": \"8 hours ago\"\n    },\n    {\n      \"title\": \"Show HN: Personal Time Tracking with Git\",\n      \"url\": \"https://doocot.sh/blog/2025/03/28/time-tracking-with-git\",\n      \"points\": 2,\n      \"by\": \"thisdougb\",\n      \"time_ago\": \"1 hour ago\"\n    },\n    {\n      \"title\": \"Show HN: An Almost Free, Open Source TURN Server\",\n      \"url\": \"https://github.com/lvidgen/WebRTC/blob/master/FOSS_TURN_Server/howto.md\",\n      \"points\": 109,\n      \"by\": \"cookie_monsta\",\n      \"time_ago\": \"12 hours ago\"\n    },\n    {\n      \"title\": \"Show HN: A web app that shows toilets near you\",\n      \"url\": \"https://www.toilette-in-der-naehe.de\",\n      \"points\": 2,\n      \"by\": \"jandr00id\",\n      \"time_ago\": \"1 hour ago\"\n    }\n  ]\n}\n```"
        },
        "done_reason": "stop",
        "done": true,
        "total_duration": 87442598900,
        "load_duration": 20314600,
        "prompt_eval_count": 4031,
        "prompt_eval_duration": 7094000000,
        "eval_count": 378,
        "eval_duration": 80316000000
      }
    }
    else if ((messages[messages.length - 1].content as string).includes('Current step: 1/')) {
        return  {
          "model": "qwen2.5:32b",
          "created_at": "2025-03-29T11:24:26.1162341Z",
          "message": {
            "role": "assistant",
            "content": "{\n  \"current_state\": {\n    \"evaluation_previous_goal\": \"Unknown - Analyze the current elements and the image to check if the previous goals/actions are successful like intended by the task. Mention if something unexpected happened. Shortly state why/why not\",\n    \"memory\": \"Starting with the new task. I have completed 0 out of 10 steps.\",\n    \"next_goal\": \"Navigate to the HackerNews 'Show HN' section\"\n  },\n  \"action\": [\n    {\n      \"go_to_url\": {\n        \"url\": \"https://news.ycombinator.com/show\"\n      }\n    }\n  ]\n}"
          },
          "done_reason": "stop",
          "done": true,
          "total_duration": 33915524700,
          "load_duration": 5623007600,
          "prompt_eval_count": 1395,
          "prompt_eval_duration": 2960000000,
          "eval_count": 132,
          "eval_duration": 25108000000
        }
    }
    else if ((messages[messages.length - 1].content as string).includes('Current step: 2/')) {
        return {
          "model": "qwen2.5:32b",
          "created_at": "2025-03-29T11:32:10.5341007Z",
          "message": {
            "role": "assistant",
            "content": "{\n  \"current_state\": {\n    \"evaluation_previous_goal\": \"Success - I have navigated to the Hacker News Show HN page.\",\n    \"memory\": \"I have completed 1 out of 10 steps. The next goal is to extract and list the first 5 posts from the Hacker News Show HN page.\",\n    \"next_goal\": \"Extract and list the first 5 posts from the Hacker News Show HN page.\"\n  },\n  \"action\": [\n    {\n      \"extract_content\": {\n        \"goal\": \"Find the titles, points, authors, and time of posting for the first 5 posts on the Hacker News Show HN page\"\n      }\n    }\n  ]\n}"
          },
          "done_reason": "stop",
          "done": true,
          "total_duration": 35248446600,
          "load_duration": 50736100,
          "prompt_eval_count": 4207,
          "prompt_eval_duration": 5476000000,
          "eval_count": 146,
          "eval_duration": 29638000000
        }
    }
    else if ((messages[messages.length - 1].content as string).includes('Current step: 3/')) {
        return {
          "model": "qwen2.5:32b",
          "created_at": "2025-03-29T11:34:25.2222492Z",
          "message": {
            "role": "assistant",
            "content": "",
            "tool_calls": [
              {
                "function": {
                  "name": "AgentOutput",
                  "arguments": {
                    "action": [
                      {
                        "done": {
                          "success": true,
                          "text": "Here are the first 5 posts from the Hacker News Show HN page:\n\n1. Title: Personal Time Tracking with Git, Points: 3, Author: thisdougb, Time of posting: 1 hour ago\n2. Title: Physical Pomodoro Timer with ESP32 and e-paper screen, Points: 2, Author: rukenshia, Time of posting: 47 minutes ago\n3. Title: Pianoboi – displays sheet music as you play your piano, Points: 43, Author: bcowde, Time of posting: 8 hours ago\n4. Title: An Almost Free, Open Source TURN Server, Points: 109, Author: cookie_monsta, Time of posting: 12 hours ago\n5. Title: A web app that shows toilets near you, Points: 2, Author: jandr00id, Time of posting: 1 hour ago"
                        }
                      }
                    ],
                    "current_state": {
                      "evaluation_previous_goal": "Success - I have successfully extracted and listed the first 5 posts from the Hacker News Show HN page.",
                      "memory": "I have completed all required steps to extract and list the first 5 posts from the Hacker News Show HN page. The task is complete.",
                      "next_goal": "Task Completed"
                    }
                  }
                }
              }
            ]
          },
          "done_reason": "stop",
          "done": true,
          "total_duration": 72207141500,
          "load_duration": 40746900,
          "prompt_eval_count": 4631,
          "prompt_eval_duration": 9026000000,
          "eval_count": 293,
          "eval_duration": 63014000000
        }
    }
}