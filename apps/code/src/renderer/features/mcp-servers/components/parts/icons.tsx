import { Plugs } from "@phosphor-icons/react";
import { Flex } from "@radix-ui/themes";
import IconAirOps from "@renderer/assets/services/airops.png";
import IconAtlassian from "@renderer/assets/services/atlassian.svg";
import IconAttio from "@renderer/assets/services/attio.png";
import IconBox from "@renderer/assets/services/box.svg";
import IconBrowserbase from "@renderer/assets/services/browserbase.svg";
import IconCanva from "@renderer/assets/services/canva.svg";
import IconCircle from "@renderer/assets/services/circle.png";
import IconCiscoThousandEyes from "@renderer/assets/services/cisco_thousandeyes.png";
import IconClerk from "@renderer/assets/services/clerk.svg";
import IconClickHouse from "@renderer/assets/services/clickhouse.svg";
import IconCloudflare from "@renderer/assets/services/cloudflare.svg";
import IconContext7 from "@renderer/assets/services/context7.svg";
import IconDatadog from "@renderer/assets/services/datadog.svg";
import IconFigma from "@renderer/assets/services/figma.svg";
import IconFiretiger from "@renderer/assets/services/firetiger.svg";
import IconGitHub from "@renderer/assets/services/github.svg";
import IconGitLab from "@renderer/assets/services/gitlab.svg";
import IconHex from "@renderer/assets/services/hex.svg";
import IconHubSpot from "@renderer/assets/services/hubspot.svg";
import IconLaunchDarkly from "@renderer/assets/services/launchdarkly.png";
import IconLinear from "@renderer/assets/services/linear.svg";
import IconMonday from "@renderer/assets/services/monday.svg";
import IconNeon from "@renderer/assets/services/neon.svg";
import IconNotion from "@renderer/assets/services/notion.svg";
import IconPagerDuty from "@renderer/assets/services/pagerduty.svg";
import IconPlanetScale from "@renderer/assets/services/planetscale.svg";
import IconPostman from "@renderer/assets/services/postman.svg";
import IconPrisma from "@renderer/assets/services/prisma.svg";
import IconRender from "@renderer/assets/services/render.svg";
import IconSanity from "@renderer/assets/services/sanity.svg";
import IconSentry from "@renderer/assets/services/sentry.svg";
import IconSlack from "@renderer/assets/services/slack.png";
import IconStripe from "@renderer/assets/services/stripe.png";
import IconSupabase from "@renderer/assets/services/supabase.svg";
import IconSvelte from "@renderer/assets/services/svelte.png";
import IconWix from "@renderer/assets/services/wix.png";

const BRAND_ICONS: Record<string, string> = {
  airops: IconAirOps,
  atlassian: IconAtlassian,
  attio: IconAttio,
  box: IconBox,
  browserbase: IconBrowserbase,
  canva: IconCanva,
  circle: IconCircle,
  cisco_thousandeyes: IconCiscoThousandEyes,
  clerk: IconClerk,
  clickhouse: IconClickHouse,
  cloudflare: IconCloudflare,
  context7: IconContext7,
  datadog: IconDatadog,
  figma: IconFigma,
  firetiger: IconFiretiger,
  github: IconGitHub,
  gitlab: IconGitLab,
  hex: IconHex,
  hubspot: IconHubSpot,
  launchdarkly: IconLaunchDarkly,
  linear: IconLinear,
  monday: IconMonday,
  neon: IconNeon,
  notion: IconNotion,
  pagerduty: IconPagerDuty,
  planetscale: IconPlanetScale,
  postman: IconPostman,
  prisma: IconPrisma,
  render: IconRender,
  sanity: IconSanity,
  sentry: IconSentry,
  slack: IconSlack,
  stripe: IconStripe,
  supabase: IconSupabase,
  svelte: IconSvelte,
  wix: IconWix,
};

export function resolveServerIcon(
  iconKey: string | null | undefined,
): string | undefined {
  return iconKey ? BRAND_ICONS[iconKey] : undefined;
}

interface ServerIconProps {
  iconKey?: string | null;
  size?: number;
  className?: string;
}

export function ServerIcon({ iconKey, size = 32, className }: ServerIconProps) {
  const src = resolveServerIcon(iconKey);
  const dimension = `${size}px`;
  const radius = 2;
  return (
    <Flex
      align="center"
      justify="center"
      className={`shrink-0 overflow-hidden ${className ?? ""}`}
      style={{ width: dimension, height: dimension, borderRadius: radius }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="size-full object-contain"
          style={{ borderRadius: radius }}
        />
      ) : (
        <Plugs size={Math.round(size * 0.55)} className="text-gray-11" />
      )}
    </Flex>
  );
}
