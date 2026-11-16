// A citizen's job, one line for every card and list (owner, 16 Nov). The server sends citizen.job =
// { id, title, place|null, major|null } (server.mjs jobView): 'student' with the major, 'unemployed', 'official', or a
// job of the catalog (Barista, Mechanic, Reporter...). Plain text only: callers set it with textContent.
const clip = (s, n = 40) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);

// a daily act as people read it (daily byAct / recent / diary): 'job_hunt' is "looking for work" (ticket #759),
// 'propose' an idea for the city taken to its Mayor (ticket #793)
const ACT_TEXT = { job_hunt: 'looking for work', propose: 'proposing an idea for the city' };
export const actLabel = act => ACT_TEXT[act] || clip(act, 40);

// the job object as the server sent it, checked; null when there is none (an older server)
export function cleanJob(j) {
  if (!j || typeof j !== 'object' || typeof j.id !== 'string' || !/^[a-z0-9_]{1,40}$/.test(j.id)) return null;
  return { id: j.id, title: clip(j.title) || null, place: typeof j.place === 'string' && /^[a-z_]{1,24}$/.test(j.place) ? j.place : null, major: j.major ? clip(j.major) || null : null };
}

// "University student · Economics", "Looking for work", the office title for officials, else the job's title.
// officeTitle: the title of the person's office when they hold one (the caller knows the roles).
export function jobLine(person, officeTitle = null) {
  const j = cleanJob(person?.job);
  if (person?.office && officeTitle) return clip(officeTitle, 60);
  if (!j) return person?.occupation === 'student' ? 'University student' : null;
  if (j.id === 'student') return `University student${j.major ? ` · ${j.major}` : ''}`;
  if (j.id === 'unemployed') return 'Looking for work';
  if (j.id === 'official') return clip(officeTitle, 60) || j.title || 'Public official';
  return j.title || null;
}

// whereabouts act 'working' means "at their job": "Working as Barista" (with the job's title when there is one)
export function workingLine(person, officeTitle = null) {
  const line = jobLine(person, officeTitle);
  const j = cleanJob(person?.job);
  if (!line) return 'At work';
  if (!j || j.id === 'unemployed' || j.id === 'student') return line;
  return `Working as ${line}`;
}
