import type { JSX } from 'react';
import { StudentCard } from '@/components/students/student-card';

export default async function StudentCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  return <StudentCard studentId={id} />;
}
