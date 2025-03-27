import { z } from 'zod';

export const BaseAction = z.any();

export const SearchGoogleAction = z.object({
  query: z.string(),
});

export const GoToUrlAction = z.object({
  url: z.string(),
});

export const ClickElementAction = z.object({
  index: z.number(),
  xpath: z.string().optional(),
});

export const InputTextAction = z.object({
  index: z.number(),
  text: z.string(),
  xpath: z.string().optional(),
})

export const DoneAction = z.object({
  text: z.string(),
  success: z.boolean(),
});

export const SwitchTabAction = z.object({
  page_id: z.number(),
});

export const OpenTabAction = z.object({
  url: z.string(),
});

export const ScrollAction = z.object({
  amount: z.number().optional(),
});

export const SendKeysAction = z.object({
  keys: z.string(),
});

export const ExtractPageContentAction = z.object({
  value: z.string(),
});

export const NoParamsAction = z.any();
