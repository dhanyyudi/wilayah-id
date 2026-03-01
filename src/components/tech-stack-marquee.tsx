"use client";

import { cn } from "@/lib/utils";

interface TechItem {
  name: string;
  icon: React.ReactNode;
}

// Real SVG logos for each tech stack
const techStack: TechItem[] = [
  {
    name: "Next.js",
    icon: (
      <svg viewBox="0 0 180 180" className="w-6 h-6" fill="currentColor">
        <mask id="nextjs-mask">
          <circle cx="90" cy="90" r="90" fill="white"/>
        </mask>
        <g mask="url(#nextjs-mask)">
          <circle cx="90" cy="90" r="90" fill="black" className="dark:fill-white"/>
          <path d="M149.508 157.52L69.142 54H54V126H67.627V69.384L142.715 164.877C145.236 162.573 147.443 160.088 149.508 157.52Z" fill="white" className="dark:fill-black"/>
          <rect x="115" y="54" width="12" height="72" fill="white" className="dark:fill-black"/>
        </g>
      </svg>
    ),
  },
  {
    name: "TypeScript",
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#3178C6">
        <path d="M3 3h18v18H3V3zm10.5 11.5v4h1.5v-4h2.5v-1.5h-4v1.5zm-3.5-2c0-1.1.9-2 2-2h1.5v-1.5h-1.5c-1.9 0-3.5 1.6-3.5 3.5s1.6 3.5 3.5 3.5h1.5v-1.5h-1.5c-1.1 0-2-.9-2-2z"/>
      </svg>
    ),
  },
  {
    name: "Tailwind CSS",
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#06B6D4">
        <path d="M12.001,4.8c-3.2,0-5.2,1.6-6,4.8c1.2-1.6,2.6-2.2,4.2-1.8c0.913,0.228,1.565,0.89,2.288,1.624 C13.666,10.618,15.027,12,18.001,12c3.2,0,5.2-1.6,6-4.8c-1.2,1.6-2.6,2.2-4.2,1.8c-0.913-0.228-1.565-0.89-2.288-1.624 C16.337,6.182,14.976,4.8,12.001,4.8z M6.001,12c-3.2,0-5.2,1.6-6,4.8c1.2-1.6,2.6-2.2,4.2-1.8c0.913,0.228,1.565,0.89,2.288,1.624 c1.177,1.194,2.538,2.576,5.512,2.576c3.2,0,5.2-1.6,6-4.8c-1.2,1.6-2.6,2.2-4.2,1.8c-0.913-0.228-1.565-0.89-2.288-1.624 C10.337,13.382,8.976,12,6.001,12z"/>
      </svg>
    ),
  },
  {
    name: "shadcn/ui",
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
        <rect x="3" y="3" width="7" height="7" rx="1" fill="currentColor"/>
        <rect x="14" y="3" width="7" height="7" rx="1" fill="currentColor" opacity="0.6"/>
        <rect x="14" y="14" width="7" height="7" rx="1" fill="currentColor"/>
        <rect x="3" y="14" width="7" height="7" rx="1" fill="currentColor" opacity="0.6"/>
      </svg>
    ),
  },
  {
    name: "MapLibre GL",
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#396CB2">
        <path d="M12 2L4 7v10l8 5 8-5V7l-8-5zm0 2.5L17.5 8 12 11 6.5 8 12 4.5zM5 9l6 3.5v6.5l-6-3.75V9zm14 0v6.25L13 18.5V12l6-3z"/>
      </svg>
    ),
  },
  {
    name: "mapcn",
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#F97316">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
      </svg>
    ),
  },
  {
    name: "PostgreSQL",
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#336791">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
      </svg>
    ),
  },
  {
    name: "PostGIS",
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#4DB33D">
        <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.5L19.5 8 12 11.5 4.5 8 12 4.5zM4 9.5l7 3.5v7L4 16.5v-7zm9 10.5v-7l7-3.5v7l-7 3.5z"/>
      </svg>
    ),
  },
  {
    name: "Neon",
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#00E0C6">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2"/>
        <circle cx="12" cy="12" r="4" fill="currentColor"/>
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" strokeWidth="2"/>
      </svg>
    ),
  },
  {
    name: "Vercel",
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
        <path d="M12 2L2 22H22L12 2Z"/>
      </svg>
    ),
  },
  {
    name: "Python",
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6">
        <path d="M12 2c-1.5 0-2.7.1-3.8.3C6.4 2.6 5.2 3.4 5.2 5v2.4h5.4V8H3.8c-1.6 0-3 .7-3.4 3-.4 2-.4 3.3 0 5.3.3 1.7 1 2.7 3 2.7h2V14c0-1.9 1.6-3.4 3.6-3.4h5.4c1.6 0 3-1.1 3-3.3V5c0-1.8-1.5-3.1-3.4-3.4C14.7 2.1 13.5 2 12 2zm-3 1.8c.6 0 1 .4 1 1s-.4 1-1 1-1-.4-1-1 .4-1 1-1z" fill="#3776AB"/>
        <path d="M18.2 8v2.4c0 2-1.6 3.6-3.6 3.6H9.2c-1.6 0-3 1.1-3 3.3V19c0 1.8 1.5 2.9 3.4 3.3 2.1.4 4.3.4 6.4 0 1.6-.3 3-1.1 3-3.3v-2.4h-5.4V16h6.8c1.6 0 2.3-1.1 2.7-3.3.4-2 .4-3.5 0-5.5-.3-1.7-1-2.2-2.5-2.2h-2zm-4 10.4c.6 0 1 .4 1 1s-.4 1-1 1-1-.4-1-1 .4-1 1-1z" fill="#FFD43B"/>
      </svg>
    ),
  },
  {
    name: "GeoPandas",
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#139C5A">
        <path d="M12 2L4 7l8 5 8-5-8-5zM4 9v8l8 5 8-5V9l-8 5-8-5z"/>
        <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
  {
    name: "Tippecanoe",
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#4264FB">
        <path d="M3 3h7v7H3V3zm0 11h7v7H3v-7zm11-11h7v7h-7V3zm0 11h7v7h-7v-7z"/>
      </svg>
    ),
  },
];

export function TechStackMarquee({ className }: { className?: string }) {
  // Triple the array for truly seamless infinite scroll
  const duplicatedTech = [...techStack, ...techStack, ...techStack];

  return (
    <div className={cn("w-full overflow-hidden bg-muted/30 border-y", className)}>
      <div className="relative flex overflow-hidden py-6">
        {/* Gradient masks for smooth fade */}
        <div className="absolute left-0 top-0 bottom-0 w-16 sm:w-24 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-16 sm:w-24 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />
        
        {/* Marquee content - single row */}
        <div className="flex animate-marquee gap-6 sm:gap-8 items-center">
          {duplicatedTech.map((tech, index) => (
            <div
              key={`${tech.name}-${index}`}
              className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 rounded-full bg-background/60 border border-border/60 hover:border-primary/40 hover:bg-background/90 transition-all duration-300 group shrink-0"
            >
              <span className="shrink-0 group-hover:scale-110 transition-transform duration-300">
                {tech.icon}
              </span>
              <span className="text-xs sm:text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors duration-300 whitespace-nowrap">
                {tech.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
