import { useParams } from 'react-router';
import { DiseaseDetails } from '@/features/diseases/components/DiseaseDetails';

export default function DiseasePage() {
  const number = Number(useParams().number);
  return <DiseaseDetails key={number} number={number} />;
}
