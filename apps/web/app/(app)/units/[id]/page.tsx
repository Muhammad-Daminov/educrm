import type { JSX } from 'react';
import { UnitDetail } from '@/components/units/unit-detail';

export default async function UnitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  return <UnitDetail unitId={id} />;
}
