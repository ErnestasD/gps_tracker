import { useEffect, useRef } from "react";

interface OrbitalFluidBgProps {
  className?: string;
}

export function OrbitalFluidBg({ className = "" }: OrbitalFluidBgProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // ── nebula blobs ──
    const blobs = [
      { x: 0.25, y: 0.35, r: 0.28, vx: 0.00012, vy: 0.00008, hue: 0, phase: 0, speed: 0.25, sizePhase: 0 },
      { x: 0.75, y: 0.25, r: 0.22, vx: -0.00009, vy: 0.00011, hue: 1, phase: 1.2, speed: 0.3, sizePhase: 2.1 },
      { x: 0.5, y: 0.7, r: 0.32, vx: 0.00007, vy: -0.00006, hue: 0.5, phase: 2.5, speed: 0.2, sizePhase: 4.3 },
      { x: 0.15, y: 0.75, r: 0.18, vx: 0.0001, vy: 0.00005, hue: 0.2, phase: 0.7, speed: 0.35, sizePhase: 1.5 },
      { x: 0.85, y: 0.65, r: 0.24, vx: -0.00008, vy: -0.0001, hue: 0.8, phase: 3.1, speed: 0.28, sizePhase: 3.7 },
      { x: 0.6, y: 0.45, r: 0.15, vx: 0.00006, vy: 0.00013, hue: 0.3, phase: 1.8, speed: 0.4, sizePhase: 0.9 },
    ];

    // ── orbital rings ── with per-ring satellites
    const rings = [
      { cx: 0.5, cy: 0.5, rx: 0.38, ry: 0.14, rot: 0.3, rotSpeed: 0.00015, opacity: 0.22, satSpeed: 0.35, satOffset: 0 },
      { cx: 0.5, cy: 0.5, rx: 0.32, ry: 0.11, rot: -0.5, rotSpeed: -0.0002, opacity: 0.2, satSpeed: -0.5, satOffset: 1.7 },
      { cx: 0.5, cy: 0.5, rx: 0.45, ry: 0.18, rot: 1.1, rotSpeed: 0.0001, opacity: 0.18, satSpeed: 0.22, satOffset: 3.2 },
      { cx: 0.5, cy: 0.5, rx: 0.22, ry: 0.08, rot: 2.0, rotSpeed: -0.00025, opacity: 0.2, satSpeed: -0.7, satOffset: 0.8 },
      { cx: 0.5, cy: 0.5, rx: 0.55, ry: 0.22, rot: 0.7, rotSpeed: 0.00008, opacity: 0.14, satSpeed: 0.18, satOffset: 4.5 },
    ];

    // ── stars ──
    const stars: { x: number; y: number; size: number; blinkPhase: number; blinkSpeed: number }[] = [];
    for (let i = 0; i < 140; i++) {
      stars.push({
        x: Math.random(),
        y: Math.random(),
        size: 0.3 + Math.random() * 1.4,
        blinkPhase: Math.random() * Math.PI * 2,
        blinkSpeed: 0.2 + Math.random() * 1.5,
      });
    }

    // ── floating dust particles ──
    const dust: { x: number; y: number; vx: number; vy: number; size: number; hue: number; life: number }[] = [];
    for (let i = 0; i < 45; i++) {
      dust.push({
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random() - 0.5) * 0.00006,
        vy: (Math.random() - 0.5) * 0.00006,
        size: 0.6 + Math.random() * 1.4,
        hue: Math.random(),
        life: Math.random() * Math.PI * 2,
      });
    }

    // ── shooting stars / comets (spawned over time) ──
    type Comet = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number };
    const comets: Comet[] = [];
    const spawnComet = () => {
      const fromTop = Math.random() < 0.6;
      const angle = fromTop ? Math.PI * 0.25 + Math.random() * 0.25 : Math.PI * 0.75 + Math.random() * 0.25;
      const speed = 0.35 + Math.random() * 0.35;
      comets.push({
        x: Math.random() * 0.7,
        y: -0.05 + Math.random() * 0.2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 1.2 + Math.random() * 0.8,
      });
    };
    let nextComet = 1.5;

    const cyan = { r: 76, g: 77, b: 207 };
    const violet = { r: 91, g: 33, b: 182 };
    const mixColor = (t: number) => ({
      r: Math.round(cyan.r + (violet.r - cyan.r) * t),
      g: Math.round(cyan.g + (violet.g - cyan.g) * t),
      b: Math.round(cyan.b + (violet.b - cyan.b) * t),
    });

    const now0 = performance.now();
    let lastT = 0;

    const draw = () => {
      const now = (performance.now() - now0) / 1000;
      const dt = Math.min(now - lastT, 0.05);
      lastT = now;
      ctx.clearRect(0, 0, w, h);

      // deep space base
      ctx.fillStyle = "#04070F";
      ctx.fillRect(0, 0, w, h);

      // nebula blobs
      for (const b of blobs) {
        const bx = ((b.x + b.vx * now) % 1.4 - 0.2) * w;
        const by = ((b.y + b.vy * now) % 1.4 - 0.2) * h;
        const baseR = b.r * Math.min(w, h);
        const breathe = 1 + Math.sin(now * b.speed + b.sizePhase) * 0.15;
        const r = baseR * breathe;
        const col = mixColor(b.hue);

        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, r);
        grad.addColorStop(0, `rgba(${col.r},${col.g},${col.b},0.11)`);
        grad.addColorStop(0.5, `rgba(${col.r},${col.g},${col.b},0.045)`);
        grad.addColorStop(1, `rgba(${col.r},${col.g},${col.b},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // stars (behind rings)
      for (const s of stars) {
        const blink = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(now * s.blinkSpeed + s.blinkPhase));
        const sx = s.x * w;
        const sy = s.y * h;
        ctx.fillStyle = `rgba(200,220,255,${0.45 * blink})`;
        ctx.beginPath();
        ctx.arc(sx, sy, s.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // orbital rings + satellites
      for (const ring of rings) {
        const cx = ring.cx * w;
        const cy = ring.cy * h;
        const rx = ring.rx * w;
        const ry = ring.ry * h;
        const rot = ring.rot + ring.rotSpeed * now * 1000;

        // cyan stroke
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.scale(1, ry / rx);
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.restore();
        ctx.strokeStyle = `rgba(76,77,207,${ring.opacity})`;
        ctx.lineWidth = 0.9;
        ctx.stroke();

        // violet glow stroke
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.scale(1, ry / rx);
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.restore();
        ctx.strokeStyle = `rgba(91,33,182,${ring.opacity * 0.7})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // satellite traveling along ring
        const a = now * ring.satSpeed + ring.satOffset;
        const lx = Math.cos(a) * rx;
        const ly = Math.sin(a) * ry;
        // rotate satellite point by ring rotation
        const sxp = cx + lx * Math.cos(rot) - ly * Math.sin(rot);
        const syp = cy + lx * Math.sin(rot) + ly * Math.cos(rot);

        // trail
        const trailSteps = 12;
        for (let k = trailSteps; k >= 1; k--) {
          const ak = a - k * 0.05;
          const lxk = Math.cos(ak) * rx;
          const lyk = Math.sin(ak) * ry;
          const tx = cx + lxk * Math.cos(rot) - lyk * Math.sin(rot);
          const ty = cy + lxk * Math.sin(rot) + lyk * Math.cos(rot);
          const alpha = (1 - k / trailSteps) * 0.35;
          ctx.fillStyle = `rgba(76,77,207,${alpha})`;
          ctx.beginPath();
          ctx.arc(tx, ty, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }

        // satellite glow
        const satGrad = ctx.createRadialGradient(sxp, syp, 0, sxp, syp, 12);
        satGrad.addColorStop(0, "rgba(180,240,255,0.9)");
        satGrad.addColorStop(0.3, "rgba(76,77,207,0.5)");
        satGrad.addColorStop(1, "rgba(76,77,207,0)");
        ctx.fillStyle = satGrad;
        ctx.beginPath();
        ctx.arc(sxp, syp, 12, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(220,245,255,0.95)";
        ctx.beginPath();
        ctx.arc(sxp, syp, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // floating dust
      for (const d of dust) {
        d.x += d.vx;
        d.y += d.vy;
        if (d.x < -0.02) d.x = 1.02;
        if (d.x > 1.02) d.x = -0.02;
        if (d.y < -0.02) d.y = 1.02;
        if (d.y > 1.02) d.y = -0.02;
        const flick = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(now * 0.9 + d.life));
        const col = mixColor(d.hue);
        ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${0.7 * flick})`;
        ctx.beginPath();
        ctx.arc(d.x * w, d.y * h, d.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // comets / shooting stars
      nextComet -= dt;
      if (nextComet <= 0) {
        spawnComet();
        nextComet = 2 + Math.random() * 3.5;
      }
      for (let i = comets.length - 1; i >= 0; i--) {
        const c = comets[i];
        c.life += dt;
        if (c.life > c.maxLife) {
          comets.splice(i, 1);
          continue;
        }
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        const cx = c.x * w;
        const cy = c.y * h;
        const tailLen = 140;
        const tx = cx - c.vx * w * 0.15;
        const ty = cy - c.vy * h * 0.15;
        const fade = 1 - c.life / c.maxLife;

        const grad = ctx.createLinearGradient(tx, ty, cx, cy);
        grad.addColorStop(0, "rgba(76,77,207,0)");
        grad.addColorStop(1, `rgba(200,240,255,${0.9 * fade})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(cx, cy);
        ctx.stroke();

        // head glow
        const hg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 10);
        hg.addColorStop(0, `rgba(230,250,255,${fade})`);
        hg.addColorStop(1, "rgba(91,33,182,0)");
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(cx, cy, 10, 0, Math.PI * 2);
        ctx.fill();
        // touch tail-length var to satisfy TS unused
        void tailLen;
      }

      // top-center gentle wash for readability under headline
      const topGrad = ctx.createRadialGradient(w * 0.5, 0, 0, w * 0.5, 0, w * 0.55);
      topGrad.addColorStop(0, "rgba(4,7,15,0.55)");
      topGrad.addColorStop(1, "rgba(4,7,15,0)");
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, 0, w, h * 0.5);

      animId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 -z-50 ${className}`}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
