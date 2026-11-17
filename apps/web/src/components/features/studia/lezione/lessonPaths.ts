import type { Materia } from '../../../../types/studia';

/** The cards a short lesson needs in its subject: one for the question and three for the other answers (the server's `LESSON_MIN_CARDS`). */
export const LESSON_MIN_CARDS = 4;

/** The short lesson of a subject (LC63). */
export const lessonPath = (materia: Materia) => `/learn/lezione?materia=${materia}`;
