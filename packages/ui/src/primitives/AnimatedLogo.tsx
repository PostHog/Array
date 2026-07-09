import logoLoading from "@posthog/ui/assets/images/logo-loading.gif";

interface AnimatedLogoProps {
  size?: number;
  className?: string;
}

export function AnimatedLogo({ size = 96, className }: AnimatedLogoProps) {
  return (
    <img
      src={logoLoading}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`pointer-events-none select-none ${className ?? ""}`}
    />
  );
}
