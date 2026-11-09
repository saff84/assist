export function rasterImageType(bytes: Uint8Array): { extension: string; mimeType: string } | null {
  const data = Buffer.from(bytes);
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: ".png", mimeType: "image/png" };
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return { extension: ".jpg", mimeType: "image/jpeg" };
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return { extension: ".webp", mimeType: "image/webp" };
  if (data.length >= 6 && ["GIF87a", "GIF89a"].includes(data.toString("ascii", 0, 6))) return { extension: ".gif", mimeType: "image/gif" };
  return null;
}
