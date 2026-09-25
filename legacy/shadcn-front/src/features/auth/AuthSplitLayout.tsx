import { Anchor } from "lucide-react";
import type { ReactNode } from "react";

export function AuthSplitLayout({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="from-sidebar via-sidebar to-[var(--brand-navy-dark)] relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br p-10 text-white lg:flex">
        <div
          className="pointer-events-none absolute -bottom-32 -left-24 size-80 rounded-full opacity-20 blur-3xl"
          style={{ background: "var(--primary)" }}
        />
        <div
          className="pointer-events-none absolute top-0 right-0 size-96 -translate-y-1/3 translate-x-1/3 rounded-full opacity-10 blur-3xl"
          style={{ background: "var(--primary)" }}
        />

        <div className="relative z-10 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-white">
            <Anchor className="text-sidebar size-6" />
          </div>
          <div>
            <p className="text-lg font-extrabold">Hermès</p>
            <p className="text-primary text-xs font-semibold tracking-widest uppercase">Ship Supply</p>
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-primary mb-3 text-xs font-bold tracking-[0.2em] uppercase">{eyebrow}</p>
          <h2 className="text-4xl leading-tight font-bold text-balance">{title}</h2>
          <p className="mt-4 max-w-sm text-sm text-white/70">{description}</p>
        </div>

        <p className="relative z-10 text-xs text-white/50">
          © {new Date().getFullYear()} Hermès Ship Supply · Tous droits réservés
        </p>
      </div>

      <div className="flex items-center justify-center bg-background p-6 sm:p-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
