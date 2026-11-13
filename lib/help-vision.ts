/**
 * Pictures attached to Ask Magic Keys. The help panel sends still photos, or up
 * to three moments sampled from a short clip. The clip itself is not uploaded.
 * These checks run before any picture is sent to an AI provider.
 */
export const HELP_FRAME_LIMIT = 3;
export const HELP_FRAME_BYTES = 500_000;

export type HelpFrame = { mediaType: "image/jpeg" | "image/png"; data: string };

export function parseHelpFrames(value: unknown): HelpFrame[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > HELP_FRAME_LIMIT) {
    throw new Error("Attach at most three pictures from one photo or one short clip.");
  }
  return value.map(parseHelpFrame);
}

function parseHelpFrame(item: unknown): HelpFrame {
  if (!item || typeof item !== "object") throw new Error("That picture could not be read.");
  const record = item as Record<string, unknown>;
  const mediaType = record.mediaType;
  const data = record.data;
  if (mediaType !== "image/jpeg" && mediaType !== "image/png") throw new Error("Attach a photo or a short clip.");
  if (typeof data !== "string" || data.length < 8 || data.length > 700_000 || data.length % 4 !== 0) {
    throw new Error("That picture could not be read.");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error("That picture could not be read.");
  const bytes = Buffer.from(data, "base64");
  if (bytes.byteLength < 4 || bytes.byteLength > HELP_FRAME_BYTES) {
    throw new Error("That picture is too large. Use a smaller photo or a shorter clip.");
  }
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if ((mediaType === "image/jpeg" && !jpeg) || (mediaType === "image/png" && !png)) {
    throw new Error("That picture could not be read.");
  }
  return { mediaType, data };
}

/** Latest operator turn. Text-only questions stay a string, so older requests are unchanged. */
export function visionUserContent(question: string, frames: HelpFrame[], provider: "anthropic" | "openai"): string | Array<Record<string, unknown>> {
  if (!frames.length) return question;
  if (provider === "anthropic") {
    return [
      ...frames.map((frame) => ({
        type: "image",
        source: { type: "base64", media_type: frame.mediaType, data: frame.data },
      })),
      { type: "text", text: question },
    ];
  }
  return [
    ...frames.map((frame) => ({
      type: "input_image",
      image_url: `data:${frame.mediaType};base64,${frame.data}`,
    })),
    { type: "input_text", text: question },
  ];
}
