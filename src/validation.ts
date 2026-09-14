export function isValidCustomCode(
  code: string | undefined | null,
): boolean {
  if (typeof code !== "string" || code.length < 3 || code.length > 20) {
    return false;
  }

  return /^[a-zA-Z0-9_-]+$/.test(code);
}
