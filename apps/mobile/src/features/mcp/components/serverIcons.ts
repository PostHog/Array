import type { ComponentType } from "react";
import type { ImageSourcePropType } from "react-native";
import type { SvgProps } from "react-native-svg";
import { logger } from "@/lib/logger";

const log = logger.scope("server-icons");

// SVG imports are turned into React components by react-native-svg-transformer.
import AtlassianSvg from "../../../../assets/services/atlassian.svg";
import BoxSvg from "../../../../assets/services/box.svg";
import BrowserbaseSvg from "../../../../assets/services/browserbase.svg";
import CanvaSvg from "../../../../assets/services/canva.svg";
import ClerkSvg from "../../../../assets/services/clerk.svg";
import ClickHouseSvg from "../../../../assets/services/clickhouse.svg";
import CloudflareSvg from "../../../../assets/services/cloudflare.svg";
import Context7Svg from "../../../../assets/services/context7.svg";
import DatadogSvg from "../../../../assets/services/datadog.svg";
import FigmaSvg from "../../../../assets/services/figma.svg";
import FiretigerSvg from "../../../../assets/services/firetiger.svg";
import GitHubSvg from "../../../../assets/services/github.svg";
import GitLabSvg from "../../../../assets/services/gitlab.svg";
import GranolaSvg from "../../../../assets/services/granola.svg";
import HexSvg from "../../../../assets/services/hex.svg";
import HubSpotSvg from "../../../../assets/services/hubspot.svg";
import LinearSvg from "../../../../assets/services/linear.svg";
import Mem0Svg from "../../../../assets/services/mem0.svg";
import MondaySvg from "../../../../assets/services/monday.svg";
import NeonSvg from "../../../../assets/services/neon.svg";
import NotionSvg from "../../../../assets/services/notion.svg";
import PagerDutySvg from "../../../../assets/services/pagerduty.svg";
import PlanetScaleSvg from "../../../../assets/services/planetscale.svg";
import PostmanSvg from "../../../../assets/services/postman.svg";
import PrismaSvg from "../../../../assets/services/prisma.svg";
import RenderSvg from "../../../../assets/services/render.svg";
import SanitySvg from "../../../../assets/services/sanity.svg";
import SentrySvg from "../../../../assets/services/sentry.svg";
import SupabaseSvg from "../../../../assets/services/supabase.svg";

// PNG imports — Metro resolves `require()` of an image to an asset module id
// suitable for `<Image source={...} />`.
const AiropsPng: ImageSourcePropType = require("../../../../assets/services/airops.png");
const AttioPng: ImageSourcePropType = require("../../../../assets/services/attio.png");
const CirclePng: ImageSourcePropType = require("../../../../assets/services/circle.png");
const CiscoThousandeyesPng: ImageSourcePropType = require("../../../../assets/services/cisco_thousandeyes.png");
const LaunchDarklyPng: ImageSourcePropType = require("../../../../assets/services/launchdarkly.png");
const SlackPng: ImageSourcePropType = require("../../../../assets/services/slack.png");
const StripePng: ImageSourcePropType = require("../../../../assets/services/stripe.png");
const SveltePng: ImageSourcePropType = require("../../../../assets/services/svelte.png");
const WixPng: ImageSourcePropType = require("../../../../assets/services/wix.png");

export type ServerLogo =
  | { kind: "svg"; component: ComponentType<SvgProps> }
  | { kind: "png"; source: ImageSourcePropType };

function svg(component: ComponentType<SvgProps>): ServerLogo {
  if (typeof component !== "function") {
    log.warn("SVG import resolved as non-component", {
      type: typeof component,
    });
  }
  return { kind: "svg", component };
}

function png(source: ImageSourcePropType): ServerLogo {
  return { kind: "png", source };
}

/** Lookup map keyed by `McpServerInstallation.icon_key` /
 *  `McpRecommendedServer.icon_key`. Mirrors the desktop `BRAND_ICONS`. */
export const SERVER_LOGOS: Record<string, ServerLogo> = {
  airops: png(AiropsPng),
  atlassian: svg(AtlassianSvg),
  attio: png(AttioPng),
  box: svg(BoxSvg),
  browserbase: svg(BrowserbaseSvg),
  canva: svg(CanvaSvg),
  circle: png(CirclePng),
  cisco_thousandeyes: png(CiscoThousandeyesPng),
  clerk: svg(ClerkSvg),
  clickhouse: svg(ClickHouseSvg),
  cloudflare: svg(CloudflareSvg),
  context7: svg(Context7Svg),
  datadog: svg(DatadogSvg),
  figma: svg(FigmaSvg),
  firetiger: svg(FiretigerSvg),
  github: svg(GitHubSvg),
  gitlab: svg(GitLabSvg),
  granola: svg(GranolaSvg),
  hex: svg(HexSvg),
  hubspot: svg(HubSpotSvg),
  launchdarkly: png(LaunchDarklyPng),
  linear: svg(LinearSvg),
  mem0: svg(Mem0Svg),
  monday: svg(MondaySvg),
  neon: svg(NeonSvg),
  notion: svg(NotionSvg),
  pagerduty: svg(PagerDutySvg),
  planetscale: svg(PlanetScaleSvg),
  postman: svg(PostmanSvg),
  prisma: svg(PrismaSvg),
  render: svg(RenderSvg),
  sanity: svg(SanitySvg),
  sentry: svg(SentrySvg),
  slack: png(SlackPng),
  stripe: png(StripePng),
  supabase: svg(SupabaseSvg),
  svelte: png(SveltePng),
  wix: png(WixPng),
};

export function resolveServerLogo(
  iconKey: string | null | undefined,
): ServerLogo | null {
  if (!iconKey) return null;
  return SERVER_LOGOS[iconKey] ?? null;
}
