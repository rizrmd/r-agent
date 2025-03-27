import  MarkdownConverter from 'turndown';

export function markdownify(input: string): string {
    return new MarkdownConverter().turndown(input);
}