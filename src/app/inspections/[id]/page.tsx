import { InspectionWizard } from "@/components/inspections/inspection-wizard";

export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  return <div className="px-4 sm:px-6"><InspectionWizard id={(await params).id} /></div>;
}
