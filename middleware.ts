import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_PATHS = ["/login", "/auth/callback"];

export async function middleware(req: NextRequest) {
  const { res, user } = await updateSession(req);
  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const isApi = pathname.startsWith("/api/");
  const isAsset = pathname.startsWith("/_next") || pathname === "/favicon.ico";

  if (!user && !isPublic && !isAsset) {
    if (isApi) return new NextResponse("Unauthorized", { status: 401 });
    const redirect = req.nextUrl.clone();
    redirect.pathname = "/login";
    return NextResponse.redirect(redirect);
  }

  if (user && pathname === "/login") {
    const redirect = req.nextUrl.clone();
    redirect.pathname = "/book";
    return NextResponse.redirect(redirect);
  }

  return res;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image  (image optimization files)
     * - favicon.ico, robots.txt, sitemap.xml
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
