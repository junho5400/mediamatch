import { z } from 'zod'

export const MediaTypeSchema = z.enum(['movie', 'tv', 'book'])

export const RatingSchema = z.number()
  .min(0.5, 'Rating must be at least 0.5')
  .max(5.0, 'Rating must be at most 5.0')
  .refine(val => val % 0.5 === 0, 'Rating must be in 0.5 increments')

export const ChatbotRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  mediaLog: z.array(z.object({
    title: z.string(),
    type: MediaTypeSchema,
    rating: z.number().optional(),
    tag: z.string().optional(),
    review: z.string().optional(),
  })).default([]),
})

export const AIReportRequestSchema = z.object({
  profile: z.object({
    favoriteMedia: z.record(z.unknown()).optional(),
  }).passthrough(),
})

export const WatchlistRequestSchema = z.object({
  add: z.boolean(),
})

export const EmbedReviewRequestSchema = z.object({
  review_text: z.string().min(1).max(5000),
  media_type: MediaTypeSchema,
})

export const MediaSearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  type: MediaTypeSchema.optional(),
})

export function sanitizeForPrompt(input: string): string {
  return input
    .replace(/[<>{}]/g, '')
    .replace(/```/g, '')
    .replace(/\\/g, '\\\\')
    .trim()
    .slice(0, 2000)
}
