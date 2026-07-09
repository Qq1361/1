import { AllocationForm } from "@/components/purchases/allocation-form";

export default async function AllocationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <AllocationForm orderId={id} />
    </div>
  );
}
