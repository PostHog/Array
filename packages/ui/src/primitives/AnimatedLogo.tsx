import logoLoading from "@posthog/ui/assets/images/logo-loading.gif";

interface AnimatedLogoProps {
  size?: number;
  className?: string;
}

export function AnimatedLogo({ size = 96, className }: AnimatedLogoProps) {
  return (
    <div
      className={`flex items-center justify-center rounded-[22%] bg-white ring-1 ring-black/10 ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <img
        src={logoLoading}
        alt=""
        width={size}
        height={size}
        draggable={false}
        className="pointer-events-none select-none"
      />
    </div>
  );
}
