import { useAuthActions } from "@convex-dev/auth/react";
import {
  Anchor,
  History,
  LayoutDashboard,
  LogOut,
  Moon,
  Package,
  Receipt,
  Settings,
  Sun,
  Globe,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useColorMode } from "@/theme/AppThemeProvider";

export function MainLayout({ children }: { children: ReactNode }) {
  const { signOut } = useAuthActions();
  const { mode, toggleMode } = useColorMode();
  const user = useCurrentUser();
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) =>
    path === "/admin" ? location.pathname === path : location.pathname.startsWith(path);

  const navItems = [
    { label: "Commandes", icon: Receipt, path: "/orders" },
    { label: "Catalogue", icon: Package, path: "/products" },
  ];
  const adminItems = [
    { label: "Tableau de bord", icon: LayoutDashboard, path: "/admin" },
    { label: "Utilisateurs", icon: Users, path: "/admin/users" },
    { label: "Pays", icon: Globe, path: "/admin/countries" },
    { label: "Paramètres", icon: Settings, path: "/admin/settings" },
    { label: "Journal d'activité", icon: History, path: "/admin/activity" },
  ];

  const userInitial = user?.email?.[0]?.toUpperCase() ?? "?";

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-sidebar-border">
        <SidebarHeader className="gap-0">
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white">
              <Anchor className="size-5 text-sidebar" />
            </div>
            <div className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
              <p className="truncate text-sm font-extrabold tracking-wide text-white">Hermès</p>
              <p className="truncate text-[0.65rem] font-bold tracking-wider text-primary">
                {user?.role === "admin" ? "ESPACE ADMIN" : "ESPACE EMPLOYÉ"}
              </p>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive(item.path)}
                      onClick={() => navigate(item.path)}
                      tooltip={item.label}
                      className="data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:font-semibold"
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {user?.role === "admin" && (
            <SidebarGroup>
              <SidebarGroupLabel>Administration</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {adminItems.map((item) => (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        isActive={isActive(item.path)}
                        onClick={() => navigate(item.path)}
                        tooltip={item.label}
                        className="data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:font-semibold"
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => void signOut()} tooltip="Déconnexion">
                <LogOut />
                <span>Déconnexion</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <div className="flex-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={toggleMode} aria-label="Changer de thème">
                {mode === "light" ? <Moon /> : <Sun />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{mode === "light" ? "Thème sombre" : "Thème clair"}</TooltipContent>
          </Tooltip>

          <div className="ml-1 flex items-center gap-2.5">
            <Avatar className="size-8">
              <AvatarFallback className="bg-secondary text-secondary-foreground text-xs font-semibold">
                {userInitial}
              </AvatarFallback>
            </Avatar>
            <div className="hidden leading-tight sm:block">
              <p className="text-sm font-semibold">{user?.email}</p>
              <p className="text-muted-foreground text-xs">{user?.role === "admin" ? "Administrateur" : "Utilisateur"}</p>
            </div>
          </div>
        </header>

        <main className="flex-1 space-y-4 p-4 md:p-6">
          <ErrorBoundary key={location.pathname}>{children}</ErrorBoundary>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
