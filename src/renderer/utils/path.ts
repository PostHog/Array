export function expandTildePath(path: string): string {
  if (!path.startsWith("~")) return path;
  // In renderer context, we can't access process.env directly
  // For now, return the path as-is since the main process will handle expansion
  // Or we could use a pattern like /Users/username or /home/username
  // The actual expansion should happen on the Electron main side
  return path;
}

export function compactHomePath(path: string): string {
  // Replace common home directory patterns with ~
  const userPattern = /^\/Users\/[^/]+/;
  const homePattern = /^\/home\/[^/]+/;

  if (userPattern.test(path)) {
    return path.replace(userPattern, "~");
  }
  if (homePattern.test(path)) {
    return path.replace(homePattern, "~");
  }
  return path;
}
