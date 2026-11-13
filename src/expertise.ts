// The people's fields of knowledge, as one small contract for anyone outside the Rakyat box (owner, 13 Nov).
// A plain re-export of EXPERTISE_API in src/school.ts; the fields, talents and skills themselves live in
// src/population.mjs and src/school.ts. Levels here are 0-100 (skill x 100, after fading); the school's own
// cards use levels 1-5. The government currently reads population.mjs and school.ts directly (src/roles.mjs).
//   FIELDS                    { id, name }[]   the 24 fields of knowledge
//   topFields(a, n)           { id, name, level 0-100 }[]   a citizen's n strongest fields, best first
//   fieldLevel(a, id)         number 0-100     a citizen's level in one field (0 for an unknown field)
//   fieldQuestion(id, level?) { q, right, wrong, lesson, tests } | null   an exam question from that field
import { EXPERTISE_API } from './school.ts';

export const FIELDS = EXPERTISE_API.FIELDS;
export const topFields = EXPERTISE_API.topFields;
export const fieldLevel = EXPERTISE_API.fieldLevel;
export const fieldQuestion = EXPERTISE_API.fieldQuestion;
export default EXPERTISE_API;
