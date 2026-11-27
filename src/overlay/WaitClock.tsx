import { useEffect, useState } from 'react';

/** Time since this HUD entered processing, not audio length or an ETA. */
export function WaitClock() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let timer: number;
    function tick() {
      window.clearTimeout(timer);
      if (document.hidden) return;
      const elapsed = performance.now() - start;
      setSeconds(Math.floor(elapsed / 1000));
      timer = window.setTimeout(tick, 1000 - elapsed % 1000);
    }
    tick();
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return <span aria-hidden="true" className="hud-clock">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>;
}
