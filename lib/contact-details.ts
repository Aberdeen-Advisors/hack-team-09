export function normalizeLinkedInProfileUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;

  const candidate = value.trim();
  try {
    const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate.replace(/^\/+/, "")}`);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== "linkedin.com" && !hostname.endsWith(".linkedin.com")) return undefined;

    const pathSegments = url.pathname.split("/").filter(Boolean);
    if (!(["in", "pub"].includes(pathSegments[0]?.toLowerCase())) || !pathSegments[1]) return undefined;

    url.protocol = "https:";
    return url.toString();
  } catch {
    return undefined;
  }
}
