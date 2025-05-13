export function cleanStringField(inputStr: string): string {
  let S = inputStr.trim();

  // Step 1: Remove "assistant" suffix first
  S = S.replace(/assistant\s*$/i, "").trim();

  // Step 2: Try to extract content from a Markdown code block using a general non-anchored regex.
  const markdownExtractRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
  const match = S.match(markdownExtractRegex);

  if (match && typeof match[1] === 'string') {
    S = match[1].trim();
  }

  // Step 3: Apply balanced brace extraction to the (potentially unwrapped) string.
  if (S.startsWith('{') || S.startsWith('[')) {
    let balance = 0;
    let inString = false;
    let escapeChar = false;
    let fieldEndIndex = -1;
    for (let i = 0; i < S.length; i++) {
      const char = S[i];
      if (escapeChar) { escapeChar = false; continue; }
      if (char === '\\') { escapeChar = true; continue; }
      if (char === '"') { if (!escapeChar) inString = !inString; }
      if (inString) continue;
      if (char === '{' || char === '[') balance++;
      else if (char === '}' || char === ']') {
        balance--;
        if (balance === 0) { fieldEndIndex = i; break; }
      }
    }
    if (fieldEndIndex !== -1) {
      S = S.substring(0, fieldEndIndex + 1);
    }
  }
  return S.trim();
}

export function parseJsonFromResponseText(responseText: string): any {
  let textToParse = responseText.trim();

  // Step 1: Remove "assistant" suffix from the trimmed response
  textToParse = textToParse.replace(/assistant\s*$/i, "").trim();

  // Step 2: Try to extract content from a Markdown code block if present from the suffix-cleaned string
  const markdownBlockRegex = /```(?:json)?\s*([\s\S]+?)\s*```/; // Non-greedy, one or more characters inside
  const markdownMatch = textToParse.match(markdownBlockRegex);

  if (markdownMatch && markdownMatch[1]) {
    // If a markdown block is found, use its content
    textToParse = markdownMatch[1].trim();
  }
  // If no markdown block is found, textToParse remains the suffix-cleaned response.

  try {
    return JSON.parse(textToParse);
  } catch (error) {
    console.error("Failed to parse JSON from response text:", error);
    console.error("Original response text:", responseText);
    console.error("Text attempted for parsing:", textToParse);
    throw new Error("Failed to parse JSON from response text.");
  }
}
