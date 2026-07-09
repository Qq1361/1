export const ACCESS_COOKIE_NAME = "resale_erp_access";

const TOKEN_CONTEXT = "resale-erp-access-v1:";

export async function createAccessToken(password: string): Promise<string> {
  const input = new TextEncoder().encode(`${TOKEN_CONTEXT}${password}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
