function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function getPlainLanguageSettingLabel(label: string): string {
  const normalized = normalizeWhitespace(label);
  if (!normalized) {
    return normalized;
  }

  let next = normalized;
  next = next.replace(/\bCTA\s+Label\b/gi, "Button Text");
  next = next.replace(/\bCTA\s+(URL|Link)\b/gi, "Button Link");
  next = next.replace(/\bCTA\b/gi, "Button");
  next = next.replace(/\bURL\b/g, "Link");
  next = next.replace(/\bEyebrow\b/gi, "Small Heading");
  next = next.replace(/\bKicker\b/gi, "Small Heading");

  return normalizeWhitespace(next);
}

export function getSettingJargonHint(label: string): string | null {
  if (/\bCTA\b/i.test(label)) {
    return 'CTA means "Call to action" (usually a button).';
  }

  if (/\bEyebrow\b/i.test(label) || /\bKicker\b/i.test(label)) {
    return "This is short intro text displayed above a heading in many themes.";
  }

  return null;
}
