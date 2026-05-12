"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { getBrowserSupabase } from "@/lib/supabase/browser";

const TABS: { href: string; label: string }[] = [
  { href: "/book", label: "Book" },
  { href: "/earnings", label: "Earnings" },
  { href: "/news", label: "News" },
  { href: "/options-flow", label: "Options Flow" },
  { href: "/transcripts", label: "Transcripts" },
  { href: "/journal", label: "Journal" },
  { href: "/ai-research", label: "AI Research" },
  { href: "/pnl", label: "P&L" },
  { href: "/settings", label: "Settings" },
];

export function NavTabs() {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await getBrowserSupabase().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="flex items-center justify-between border-b bg-card px-3">
      <div className="flex items-center gap-1 overflow-x-auto">
        <div className="mr-4 select-none text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          The Terminal
        </div>
        {TABS.map((t) => {
          const active = pathname === t.href || pathname?.startsWith(t.href + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "relative px-3 py-2 text-xs font-medium uppercase tracking-wider transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {active && <span className="absolute inset-x-2 bottom-0 h-[2px] bg-foreground" />}
            </Link>
          );
        })}
      </div>
      <Button variant="ghost" size="sm" onClick={signOut} className="text-xs">
        <LogOut className="mr-1 h-3 w-3" /> Sign out
      </Button>
    </nav>
  );
}
