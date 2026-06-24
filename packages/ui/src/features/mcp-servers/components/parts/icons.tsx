import { Plugs } from "@phosphor-icons/react";
import { Flex } from "@radix-ui/themes";
import IconAirOps from "../../../../assets/services/airops.png";
import IconAtlassian from "../../../../assets/services/atlassian.svg";
import IconAttio from "../../../../assets/services/attio.png";
import IconBox from "../../../../assets/services/box.svg";
import IconBrowserbase from "../../../../assets/services/browserbase.svg";
import IconCanva from "../../../../assets/services/canva.svg";
import IconCircle from "../../../../assets/services/circle.png";
import IconCiscoThousandEyes from "../../../../assets/services/cisco_thousandeyes.png";
import IconClerk from "../../../../assets/services/clerk.svg";
import IconClickHouse from "../../../../assets/services/clickhouse.svg";
import IconCloudflare from "../../../../assets/services/cloudflare.svg";
import IconContext7 from "../../../../assets/services/context7.svg";
import IconDatadog from "../../../../assets/services/datadog.svg";
import IconFigma from "../../../../assets/services/figma.svg";
import IconFiretiger from "../../../../assets/services/firetiger.svg";
import IconGitHub from "../../../../assets/services/github.svg";
import IconGitLab from "../../../../assets/services/gitlab.svg";
import IconGranola from "../../../../assets/services/granola.svg";
import IconHex from "../../../../assets/services/hex.svg";
import IconHubSpot from "../../../../assets/services/hubspot.svg";
import IconLaunchDarkly from "../../../../assets/services/launchdarkly.png";
import IconLinear from "../../../../assets/services/linear.svg";
import IconMem0 from "../../../../assets/services/mem0.svg";
import IconMonday from "../../../../assets/services/monday.svg";
import IconNeon from "../../../../assets/services/neon.svg";
import IconNotion from "../../../../assets/services/notion.svg";
import IconPagerDuty from "../../../../assets/services/pagerduty.svg";
import IconPlanetScale from "../../../../assets/services/planetscale.svg";
import IconPostman from "../../../../assets/services/postman.svg";
import IconPrisma from "../../../../assets/services/prisma.svg";
import IconRender from "../../../../assets/services/render.svg";
import IconSanity from "../../../../assets/services/sanity.svg";
import IconSentry from "../../../../assets/services/sentry.svg";
import IconSlack from "../../../../assets/services/slack.png";
import IconStripe from "../../../../assets/services/stripe.png";
import IconSupabase from "../../../../assets/services/supabase.svg";
import IconSvelte from "../../../../assets/services/svelte.png";
import IconWix from "../../../../assets/services/wix.png";

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
  granola: IconGranola,
  hex: IconHex,
  hubspot: IconHubSpot,
  launchdarkly: IconLaunchDarkly,
  linear: IconLinear,
  mem0: IconMem0,
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
