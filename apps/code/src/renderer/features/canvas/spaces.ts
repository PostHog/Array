// Home space route paths. The canvas nav's Home button and the root layout's
// "render the Home sidenav" branch both key off this so the whole Home space
// (the / scene plus its canvas routes) shares one chrome. Extend as canvas
// routes are added.
export function isHomeSpacePath(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/website");
}
