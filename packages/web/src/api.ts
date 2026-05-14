export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  if (!contentType.includes("application/json")) {
    throw new Error(`Expected JSON from ${path}; received ${contentType || "unknown content type"}`);
  }
  return response.json() as Promise<T>;
}
