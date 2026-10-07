import { validateInstagramUrl } from "@/lib/validation";
import { safeFetchText } from "@/lib/content/safeFetch";
import {
  extractCaptionFromDescription,
  extractMetaContent,
  extractUsernameFromDescription,
} from "@/lib/content/htmlMeta";
import type { ContentProvider, ProviderResult } from "@/lib/content/types";

const ALLOWED_HOSTS = new Set(["www.instagram.com", "instagram.com"]);

export const instagramProvider: ContentProvider = {
  platform: "instagram",

  canHandle(url: string): boolean {
    return validateInstagramUrl(url).ok;
  },

  async retrieve(url: string): Promise<ProviderResult> {
    const validated = validateInstagramUrl(url);
    if (!validated.ok) {
      return { ok: false, reason: "no_data" };
    }

    const fetched = await safeFetchText(validated.normalizedUrl, ALLOWED_HOSTS);
    if (!fetched.ok) {
      return { ok: false, reason: fetched.reason };
    }

    const title = extractMetaContent(fetched.body, "og:title");
    const description = extractMetaContent(fetched.body, "og:description");
    const imageUrl = extractMetaContent(fetched.body, "og:image");

    if (!title && !description && !imageUrl) {
      return { ok: false, reason: "no_data" };
    }

    return {
      ok: true,
      caption: extractCaptionFromDescription(description),
      creatorUsername: extractUsernameFromDescription(description),
      title,
      description,
      imageUrl,
    };
  },
};
