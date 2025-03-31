import  MarkdownConverter from 'turndown';

export function markdownify(input: string, options?: {removeScript?: boolean; removeCss?: boolean}): string {
    if (options?.removeScript) {
        const scriptRegex = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
        input = input.replace(scriptRegex, '');
    }
    if (options?.removeCss) {
        const cssRegex = /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi;
        input = input.replace(cssRegex, '');
    }
    return new MarkdownConverter().turndown(input);
}