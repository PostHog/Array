import {
  Activity,
  Code,
  Copy,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  Filter,
  Flag,
  FlaskConical,
  GripVertical,
  List,
  Map as MapIcon,
  MessageSquare,
  Minus,
  MousePointer,
  Pencil,
  Play,
  Plus,
  Quote,
  Repeat,
  RotateCcw,
  Route,
  Send,
  Sparkles,
  Trash2,
  TrendingUp,
  Upload,
  Users,
  X,
} from "lucide-react";
import type { ComponentProps, ComponentType, JSX } from "react";

// Shim for the upstream `@posthog/icons` package. Its published builds inline
// a React 18 `react-jsx-runtime`, whose elements React 19 refuses to render
// ("A React Element from an older version of React was rendered"), so the
// vendored editor uses lucide equivalents — the icon set the rest of this app
// already ships. PostHog icons render at 1em and inherit currentColor, so the
// wrapper matches that contract.

type IconProps = ComponentProps<"svg"> & { size?: string | number };

function makeIcon(
  LucideIcon: ComponentType<{ size?: string | number; className?: string }>,
): (props: IconProps) => JSX.Element {
  return function Icon({ size = "1em", ...props }: IconProps) {
    return <LucideIcon size={size} {...props} />;
  };
}

export const IconCode = makeIcon(Code);
export const IconComment = makeIcon(MessageSquare);
export const IconCopy = makeIcon(Copy);
export const IconCursor = makeIcon(MousePointer);
export const IconDatabase = makeIcon(Database);
export const IconDrag = makeIcon(GripVertical);
export const IconExternal = makeIcon(ExternalLink);
export const IconEye = makeIcon(Eye);
export const IconFlag = makeIcon(Flag);
export const IconFlask = makeIcon(FlaskConical);
export const IconFunnels = makeIcon(Filter);
export const IconGraph = makeIcon(TrendingUp);
export const IconHide = makeIcon(EyeOff);
export const IconLifecycle = makeIcon(Activity);
export const IconList = makeIcon(List);
export const IconMap = makeIcon(MapIcon);
export const IconMinus = makeIcon(Minus);
export const IconPencil = makeIcon(Pencil);
export const IconPeople = makeIcon(Users);
export const IconPlus = makeIcon(Plus);
export const IconQuote = makeIcon(Quote);
export const IconRetention = makeIcon(RotateCcw);
export const IconRewindPlay = makeIcon(Play);
export const IconSend = makeIcon(Send);
export const IconSparkles = makeIcon(Sparkles);
export const IconStickiness = makeIcon(Repeat);
export const IconTrash = makeIcon(Trash2);
export const IconTrends = makeIcon(TrendingUp);
export const IconUserPaths = makeIcon(Route);
export const IconUpload = makeIcon(Upload);
export const IconX = makeIcon(X);
