/**
 * Stand-ins for the three `lib/lemon-ui/icons` icons the vendored editor uses,
 * backed by lucide-react and sized to 1em to match posthog icon conventions.
 */
import { Bold, Italic, Link } from "lucide-react";
import type { ComponentProps, JSX } from "react";

type IconProps = ComponentProps<typeof Bold>;

export function IconBold(props: IconProps): JSX.Element {
  return <Bold size="1em" {...props} />;
}

export function IconItalic(props: IconProps): JSX.Element {
  return <Italic size="1em" {...props} />;
}

export function IconLink(props: IconProps): JSX.Element {
  return <Link size="1em" {...props} />;
}
