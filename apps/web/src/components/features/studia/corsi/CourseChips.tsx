import { StatusChip, type StatusType } from '../../../ui/StatusChip';
import type { StatoCorso, StatoModulo, StatoPadronanza } from '../../../../types/corsi';
import { COURSE_STATE_LABEL, MASTERY_LABEL, MODULE_STATE_LABEL } from './corsiLabels';

/** The states of «Percorsi» in words, on `StatusChip`'s tones: never told by colour alone. */

const COURSE_TONE: Record<StatoCorso, StatusType> = { 'in-preparazione': 'unread', 'in-corso': 'reading', superato: 'done' };
const MASTERY_TONE: Record<StatoPadronanza, StatusType> = { 'da-iniziare': 'unread', 'in-corso': 'reading', acquisita: 'done', 'da-riprendere': 'important' };
const MODULE_TONE: Record<StatoModulo, StatusType> = { 'da-iniziare': 'unread', 'in-corso': 'reading', fatto: 'done', ritirato: 'unread' };

export function CourseStateChip({ stato }: { stato: StatoCorso }) {
  return <StatusChip status={COURSE_TONE[stato]} size="sm" label={COURSE_STATE_LABEL[stato]} showIcon={false} />;
}

export function MasteryChip({ stato }: { stato: StatoPadronanza }) {
  return <StatusChip status={MASTERY_TONE[stato]} size="sm" label={MASTERY_LABEL[stato]} showIcon={false} />;
}

export function ModuleStateChip({ stato }: { stato: StatoModulo }) {
  return <StatusChip status={MODULE_TONE[stato]} size="sm" label={MODULE_STATE_LABEL[stato]} showIcon={false} />;
}
