import { ArrowLeft, BookOpenText } from 'lucide-react';
import { Alert, AsyncContent, Badge, ButtonLink, Card, CardBody, CardHeader } from '@/shared/ui';
import { SAFETY_NOTICE, SOURCE_STATUS_LABEL } from '../lib/labels';
import { useDiseaseSource } from '../model/diseases.queries';

/** "Asl matn": the whole source, line by line, exactly as supplied. */
export function DiseaseSourceText() {
  const source = useDiseaseSource();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <ButtonLink to="/diseases" variant="ghost" size="sm" icon={<ArrowLeft aria-hidden className="size-4" />}>
          Kasalliklar ro‘yxati
        </ButtonLink>
      </div>
      <Alert tone="warning" title="Diqqat">
        {SAFETY_NOTICE}
      </Alert>
      <AsyncContent query={source}>
        {(data) => (
          <Card>
            <CardHeader
              title="Asl matn"
              description={`${data.diseaseCount} ta kasallik · ${data.groupCount} ta bo‘lim · o‘zgartirilmagan`}
              icon={<BookOpenText className="size-5" />}
            />
            <CardBody className="flex flex-col gap-4">
              <div>
                <Badge tone="warning">{SOURCE_STATUS_LABEL}</Badge>
              </div>
              <pre
                aria-label="Manba matni"
                className="font-sans text-[15px] leading-relaxed break-words whitespace-pre-wrap text-ink"
              >
                {data.fullText}
              </pre>
            </CardBody>
          </Card>
        )}
      </AsyncContent>
    </div>
  );
}
