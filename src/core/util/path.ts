export function normalizeWindowsDriveRoot(value: string): string {
  return process.platform === "win32" && /^[A-Za-z]:$/u.test(value)
    ? `${value}\\`
    : value;
}
