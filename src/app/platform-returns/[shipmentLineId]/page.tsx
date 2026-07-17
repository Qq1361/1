import { PlatformReturnDetail } from "@/components/platform-returns/platform-return-detail";

export default async function PlatformReturnDetailPage({ params }: { params: Promise<{ shipmentLineId: string }> }) {
  return <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8"><PlatformReturnDetail shipmentLineId={(await params).shipmentLineId} /></div>;
}
