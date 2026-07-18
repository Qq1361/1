"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  CircleDollarSign,
  ClipboardCheck,
  LayoutDashboard,
  Menu,
  Package,
  ReceiptText,
  RotateCcw,
  ShoppingBag,
  TrendingUp,
  Undo2,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const navGroups = [
  {
    label: "日常运营",
    items: [
      { label: "工作台", href: "/", icon: LayoutDashboard },
      { label: "采购订单", href: "/purchases", icon: ReceiptText },
      { label: "待验货", href: "/inspections", icon: ClipboardCheck },
      { label: "库存", href: "/inventory", icon: Boxes },
    ],
  },
  {
    label: "采购与流转",
    items: [
      { label: "采购售后", href: "/purchase-after-sales", icon: RotateCcw },
      { label: "行情管理", href: "/market", icon: TrendingUp },
      { label: "寄送批次", href: "/shipments", icon: Package },
      { label: "平台退回", href: "/platform-returns", icon: Undo2 },
    ],
  },
  {
    label: "销售与结算",
    items: [
      { label: "销售订单", href: "/sales", icon: ShoppingBag },
      { label: "销售售后", href: "/sales-after-sales", icon: RotateCcw },
      { label: "销售报表", href: "/reports/sales", icon: BarChart3 },
      { label: "每日经营报告", href: "/reports/daily", icon: BarChart3 },
      { label: "到账管理", href: "/sales/settlements", icon: CircleDollarSign },
    ],
  },
];

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3" aria-label="Resale ERP 首页">
      <span className="grid size-10 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
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
    <nav className="space-y-3" aria-label="主导航">
      {navGroups.map((group) => (
        <div key={group.label} className="space-y-0.5">
          <p className="px-3 text-xs font-medium text-muted-foreground">
            {group.label}
          </p>
          {group.items.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href ||
              (item.href !== "/" &&
                pathname.startsWith(`${item.href}/`) &&
                !(item.href === "/sales" && pathname.startsWith("/sales/settlements")));
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={buttonVariants({
                  variant: "ghost",
                  size: "default",
                  className: `h-11 w-full justify-start md:h-9 ${
                    active
                      ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`,
                })}
              >
                <Icon />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
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
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6">
          <Brand />
          <Sheet>
            <SheetTrigger
              render={(props) => (
                <button
                  {...props}
                  className={buttonVariants({ variant: "outline", size: "icon", className: "h-11 w-11" }) + " md:hidden"}
                >
                  <Menu />
                  <span className="sr-only">打开导航</span>
                </button>
              )}
            />
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
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-64 shrink-0 self-start overflow-y-auto border-r bg-sidebar/70 p-4 md:block">
          <Navigation pathname={pathname} />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
