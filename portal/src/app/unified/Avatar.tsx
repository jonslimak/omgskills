import { useEffect, useState } from "react";
import { Lock } from "lucide-react";

export function Avatar({ name, src, size = "small" }: { name: string; src?: string; size?: "small" | "medium" | "large" }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setFailed(false); setLoaded(false); }, [src]);
  return <span className={`ua-avatar ua-avatar-${size}`} aria-hidden="true">
    {src && !failed ? <img src={src} alt="" loading="lazy" decoding="async" data-loaded={loaded}
      // Cached images can finish before React attaches onLoad.
      ref={img => { if (img?.complete && img.naturalWidth) setLoaded(true); }}
      onLoad={() => setLoaded(true)} onError={() => setFailed(true)} /> : name.slice(0, 2).toUpperCase() || <Lock />}
  </span>;
}
