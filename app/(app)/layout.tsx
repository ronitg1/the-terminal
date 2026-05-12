import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { TickerBanner } from "@/components/banner/TickerBanner";
import { NavTabs } from "@/components/shell/NavTabs";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  return (
    <div className="min-h-screen flex flex-col">
      <TickerBanner />
      <NavTabs />
      <main className="flex-1 px-3 py-3">{children}</main>
    </div>
  );
}
