import { useConnectivityStore } from "@stores/connectivityStore";

export function useConnectivity() {
  const isOnline = useConnectivityStore((s) => s.isOnline);
  const isChecking = useConnectivityStore((s) => s.isChecking);
  const check = useConnectivityStore((s) => s.check);

  return { isOnline, isChecking, check };
}
