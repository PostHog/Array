import { Robot } from "@phosphor-icons/react";
import type { McpGatewayUser } from "@posthog/api-client/posthog-client";
import { Flex } from "@radix-ui/themes";

export function gatewayUserName(user: McpGatewayUser): string {
  const name = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || user.email;
}

function initialsOf(user: McpGatewayUser): string {
  const parts = [user.first_name, user.last_name].filter(
    (part): part is string => !!part,
  );
  if (parts.length) {
    return parts
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }
  return user.email.slice(0, 2).toUpperCase();
}

// Deterministic per-user avatar hue so a member renders the same color on
// every row without storing anything.
function hueOf(user: McpGatewayUser): number {
  const seed = user.uuid || user.email;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

const AVATAR_SIZES = { sm: 20, md: 26, lg: 40 } as const;

export function UserAvatar({
  user,
  size = "md",
  className,
}: {
  user: McpGatewayUser;
  size?: keyof typeof AVATAR_SIZES;
  className?: string;
}) {
  const px = AVATAR_SIZES[size];
  return (
    <Flex
      align="center"
      justify="center"
      title={gatewayUserName(user)}
      className={`shrink-0 rounded-full font-semibold text-white ${className ?? ""}`}
      style={{
        width: px,
        height: px,
        fontSize: Math.round(px * 0.38),
        background: `oklch(58% 0.11 ${hueOf(user)})`,
      }}
    >
      {initialsOf(user)}
    </Flex>
  );
}

export function RobotAvatar({
  size = "md",
  className,
}: {
  size?: keyof typeof AVATAR_SIZES;
  className?: string;
}) {
  const px = AVATAR_SIZES[size];
  return (
    <Flex
      align="center"
      justify="center"
      className={`shrink-0 bg-gray-4 text-gray-11 ${className ?? ""}`}
      style={{ width: px, height: px, borderRadius: Math.round(px * 0.27) }}
    >
      <Robot size={Math.round(px * 0.62)} />
    </Flex>
  );
}

export function AvatarStack({
  users,
  max = 4,
}: {
  users: McpGatewayUser[];
  max?: number;
}) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <Flex align="center" className="-space-x-1">
      {shown.map((user) => (
        <UserAvatar
          key={user.uuid || user.email}
          user={user}
          size="sm"
          className="ring-(--gray-1) ring-1"
        />
      ))}
      {extra > 0 && (
        <Flex
          align="center"
          justify="center"
          className="h-[20px] w-[20px] shrink-0 rounded-full bg-gray-4 font-medium text-[9px] text-gray-11 ring-(--gray-1) ring-1"
        >
          +{extra}
        </Flex>
      )}
    </Flex>
  );
}
