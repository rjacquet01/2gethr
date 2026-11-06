// Re-mounts on every navigation inside the app, so each page eases in.
// Tiny and GPU-friendly; disabled for people who prefer reduced motion.
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
      {children}
    </div>
  )
}
