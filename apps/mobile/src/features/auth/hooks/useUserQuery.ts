import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../stores/authStore";

export interface UserData {
  id: number;
  uuid: string;
  first_name: string;
  last_name?: string;
  email: string;
  is_staff?: boolean;
  organization?: {
    id: string;
    name: string;
  };
  team?: {
    id: number;
    name: string;
  };
}

export function useUserQuery() {
  const { cloudRegion, oauthAccessToken, getCloudUrlFromRegion } =
    useAuthStore();

  return useQuery({
    queryKey: ["user", "me"],
    queryFn: async (): Promise<UserData> => {
      if (!cloudRegion) throw new Error("No cloud region");
      const baseUrl = getCloudUrlFromRegion(cloudRegion);
      const response = await fetch(`${baseUrl}/api/users/@me/`, {
        headers: {
          Authorization: `Bearer ${oauthAccessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch user: ${response.statusText}`);
      }

      const data: UserData = await response.json();
      return data;
    },
    enabled: !!cloudRegion && !!oauthAccessToken,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
