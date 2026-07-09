"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Menu, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const navItems = [
  { label: "工作台", href: "/", icon: LayoutDashboard },
  { label: "采购订单", href: "/purchases", icon: ReceiptText },
];

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3" aria-label="Resale ERP 首页">
      <span className="grid size-9 place-items-center rounded-md bg-foreground text-sm font-bold text-background">
        R
      </span>
      <span>
        <span className="block text-sm font-semibold">Resale ERP</span>
        <span className="block text-xs text-muted-foreground">二手交易管理</span>
      </span>
    </Link>
  );
}

function Navigation({ pathname }: { pathname: string }) {
  return (
    <nav className="space-y-1" aria-label="主导航">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active =
          pathname === item.href ||
          (item.href !== "/" && pathname.startsWith(item.href));
        return (
          <Button
            key={item.label}
            variant={active ? "secondary" : "ghost"}
            className="w-full justify-start"
            render={<Link href={item.href} />}
          >
            <Icon />
            {item.label}
          </Button>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/access") {
    return <>{children}</>;
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6">
          <Brand />
          <Sheet>
            <SheetTrigger
              render={
                <Button variant="outline" size="icon" className="md:hidden" />
              }
            >
              <Menu />
              <span className="sr-only">打开导航</span>
            </SheetTrigger>
            <SheetContent side="left" className="w-72">
              <SheetHeader className="border-b">
                <SheetTitle>
                  <Brand />
                </SheetTitle>
              </SheetHeader>
              <div className="p-4">
                <Navigation pathname={pathname} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1440px]">
        <aside className="hidden min-h-[calc(100dvh-4rem)] w-60 shrink-0 border-r p-4 md:block">
          <Navigation pathname={pathname} />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
