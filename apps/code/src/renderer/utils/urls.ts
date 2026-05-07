import { getCachedAuthState } from "@features/auth/hooks/authQueries";
import type { CloudRegion } from "@shared/types/regions";
import { getCloudUrlFromRegion } from "@shared/utils/urls";

export function getPostHogUrl(
  pathOrUrl: string,
  regionOverride?: CloudRegion | null,
): string | null {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const region = regionOverride ?? getCachedAuthState().cloudRegion;
  if (!region) return null;
  const base = getCloudUrlFromRegion(region);
  return `${base}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

export function getBillingUrl(
  regionOverride?: CloudRegion | null,
): string | null {
  return getPostHogUrl("/organization/billing/overview", regionOverride);
}
