// The "interpreter" that decides which element props can be edited inline in
// edit mode. A prop is editable iff it's an allow-listed static-text prop AND
// its current value is a plain string literal.
//
// Data props (Stat.value/delta, Table.rows/columns, BarList.items, Grid.columns,
// etc.) are simply absent from the allow-list, so they're never inline-editable.
// And because a json-render binding is an object (`{ $state: "..." }`), any
// non-string value is automatically excluded — so this rule already composes
// with a future where data arrives as bindings, with no change.
const EDITABLE_TEXT_PROPS: Record<string, readonly string[]> = {
  Page: ["/title"],
  Card: ["/title"],
  Heading: ["/text"],
  Text: ["/text"],
  Stat: ["/label"],
  Badge: ["/text"],
  Hero: ["/title", "/eyebrow", "/subtitle", "/ctaText"],
  Button: ["/text"],
};

export function isEditableTextProp(
  type: string,
  propPath: string,
  props: Record<string, unknown>,
): boolean {
  if (!EDITABLE_TEXT_PROPS[type]?.includes(propPath)) return false;
  // Catalog prop paths are single segments (e.g. "/title"). A non-string
  // (incl. a `{ $state }` binding object) is never inline-editable.
  return typeof props[propPath.replace(/^\//, "")] === "string";
}
