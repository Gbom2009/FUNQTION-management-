/**
 * Save a file: share sheet with a file where supported (iOS), else a
 * download link (desktop / WebView2).
 */
export async function saveFile(name: string, text: string | Blob, mime: string): Promise<"shared" | "downloaded" | "failed"> {
  const blob = typeof text === "string" ? new Blob([text], { type: mime }) : text;
  const file = new File([blob], name, { type: mime });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return "shared";
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return "failed";
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return "downloaded";
  } catch {
    return "failed";
  }
}

export function safeFileName(s: string): string {
  return s.replace(/[^\w\-. ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "route";
}
