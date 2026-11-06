import Anthropic from "@anthropic-ai/sdk"
import { IMPORT_OUTPUT_SCHEMA, importSystemPrompt, smartImportModel } from "./smart-import"

// The one Smart Import model call. Only the image or text the person chose,
// today's date and their time zone are sent; nothing else about the family.
// The reply is never stored or logged. Tests replace smartImportAi.extract.

export class SmartImportProviderError extends Error {}

export interface ExtractInput {
  /** A JPEG (re-encoded by processFlyerImage, so no EXIF) */
  image?: Buffer
  text?: string
  timeZone: string
  today: { date: string; weekday: string }
}

let client: Anthropic | null = null
function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new SmartImportProviderError("ANTHROPIC_API_KEY is not set")
  if (!client) client = new Anthropic({ timeout: 45_000, maxRetries: 1 })
  return client
}

async function extract(input: ExtractInput): Promise<unknown> {
  const content: Anthropic.ContentBlockParam[] = input.image
    ? [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: input.image.toString("base64") } },
        { type: "text", text: "List the events in this image." },
      ]
    : [{ type: "text", text: `List the events in this text:\n\n<text>\n${input.text ?? ""}\n</text>` }]

  const response = await anthropic().messages.create({
    model: smartImportModel(),
    max_tokens: 8000,
    system: importSystemPrompt(input.timeZone, input.today),
    messages: [{ role: "user", content }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: IMPORT_OUTPUT_SCHEMA } },
  })
  if (response.stop_reason !== "end_turn") throw new SmartImportProviderError(`stop_reason ${response.stop_reason}`)
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text
  if (!text) throw new SmartImportProviderError("no text in the reply")
  try {
    return JSON.parse(text)
  } catch {
    throw new SmartImportProviderError("reply was not JSON")
  }
}

export const smartImportAi = { extract }

/** A short, content-free description of a failure for the logs. */
export function providerErrorLabel(err: unknown): string {
  if (err instanceof Anthropic.APIError) return `api ${err.status ?? "?"} ${err.name}`
  if (err instanceof SmartImportProviderError) return err.message
  return (err as Error)?.name || "unknown"
}
