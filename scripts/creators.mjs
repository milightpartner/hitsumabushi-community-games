// Team creators (creators.json at the repo root).
//
// A game's manifest.json `creatorGithub` is normally the submitter's own GitHub login. It can
// instead name a team defined in creators.json (e.g. "milightpartner" for Milight's official
// games): any listed member may then submit/update that game. (`displayName` is kept for crediting
// the team on guide pages; the current guide engine, hitsudoc, doesn't show authors yet.)
// creators.json lives outside games/, so validatePr() only lets maintainers change it - a creator
// can't add themselves to a team or invent one.

/** @typedef {Record<string, { displayName?: string, members?: string[] }>} Creators */

function findTeam(creatorGithub, creators) {
  if (!creatorGithub) return null;
  const key = Object.keys(creators ?? {}).find((k) => k.toLowerCase() === creatorGithub.toLowerCase());
  return key ? creators[key] : null;
}

/** Whether GitHub user `login` may act as `creatorGithub` (themselves, or a member of that team). */
export function canActFor(creatorGithub, login, creators) {
  if (!creatorGithub || !login) return false;
  if (creatorGithub.toLowerCase() === login.toLowerCase()) return true;
  const team = findTeam(creatorGithub, creators);
  return Boolean(team?.members?.some((m) => m.toLowerCase() === login.toLowerCase()));
}
