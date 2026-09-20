export async function fileToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return { base64: buffer.toString("base64"), mediaType: file.type || "image/jpeg" };
}

export function toDataUri(base64: string, mediaType: string): string {
  return `data:${mediaType};base64,${base64}`;
}
