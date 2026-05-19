import { motion } from "framer-motion";

interface LoginTransitionProps {
  isAnimating: boolean;
  isDarkMode: boolean;
  onComplete: () => void;
}

export function LoginTransition({
  isAnimating,
  isDarkMode,
  onComplete,
}: LoginTransitionProps) {
  if (!isAnimating || !isDarkMode) return null;

  return (
    <motion.div
      style={{
        zIndex: 10000,
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      onAnimationComplete={onComplete}
      className="fixed inset-0 bg-(--color-background)"
    />
  );
}
