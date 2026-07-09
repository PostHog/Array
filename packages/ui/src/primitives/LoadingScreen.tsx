import { AnimatedLogo } from "@posthog/ui/primitives/AnimatedLogo";

interface LoadingScreenProps {
  logoSize?: number;
  className?: string;
}

export function LoadingScreen({
  logoSize = 96,
  className,
}: LoadingScreenProps) {
  return (
    <div
      className={`flex h-full w-full items-center justify-center ${className ?? ""}`}
    >
      <AnimatedLogo size={logoSize} />
    </div>
  );
}
