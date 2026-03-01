"use client";

import { useEffect, useRef, useState } from "react";
import Lottie, { LottieRefCurrentProps } from "lottie-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

// Import both animations
import lightAnimation from "@/../public/lottie/search_light.json";
import darkAnimation from "@/../public/lottie/search_dark.json";

interface SearchAnimationProps {
  className?: string;
}

export function SearchAnimation({ className }: SearchAnimationProps) {
  const lottieRef = useRef<LottieRefCurrentProps>(null);
  const { resolvedTheme } = useTheme();
  const [isLoaded, setIsLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // Auto-play animation on load
    if (lottieRef.current && mounted) {
      lottieRef.current.play();
    }
  }, [mounted]);

  const handleComplete = () => {
    // Loop animation smoothly
    if (lottieRef.current) {
      setTimeout(() => {
        lottieRef.current?.goToAndPlay(0);
      }, 800); // Pause before restarting
    }
  };

  // Select animation based on theme
  const animationData = resolvedTheme === "dark" ? darkAnimation : lightAnimation;

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className={cn("w-full max-w-xl mx-auto h-16", className)}>
        {/* Placeholder to prevent layout shift */}
        <div className="w-full h-full rounded-full bg-muted/30 animate-pulse" />
      </div>
    );
  }

  return (
    <div 
      className={cn(
        "w-full max-w-xl mx-auto transition-opacity duration-500",
        isLoaded ? "opacity-100" : "opacity-0",
        className
      )}
    >
      {/* Lottie animation container - generous size for both themes */}
      <div className="relative">
        <Lottie
          lottieRef={lottieRef}
          animationData={animationData}
          loop={false}
          onComplete={handleComplete}
          onDOMLoaded={() => setIsLoaded(true)}
          className="w-full h-auto"
          style={{ maxHeight: 64, minHeight: 56 }}
        />
      </div>
    </div>
  );
}
