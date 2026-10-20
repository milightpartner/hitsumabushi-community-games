// Team creators (creators.json at the repo root).
//
// A game's manifest.json `creator` is normally the submitter's own GitHub login. It can
// instead name a team defined in creators.json (e.g. "milightpartner" for Milight's official
// games): any listed member may then submit/update that game. (A team's display name is not kept
// here: the portal's catalog holds every game's display name - OmoshiroGamePortal#618.)
// creators.json lives outside games/, so validatePr() only lets maintainers change it - a creator
// can't add themselves to a team or invent one.

/** @typedef {Record<string, { members?: string[] }>} Creators */

function findTeam(creator, creators) {
  if (!creator) return null;
  const key = Object.keys(creators ?? {}).find((k) => k.toLowerCase() === creator.toLowerCase());
  return key ? creators[key] : null;
}

/** Whether GitHub user `login` may act as `creator` (themselves, or a member of that team). */
export function canActFor(creator, login, creators) {
  if (!creator || !login) return false;
  if (creator.toLowerCase() === login.toLowerCase()) return true;
  const team = findTeam(creator, creators);
  return Boolean(team?.members?.some((m) => m.toLowerCase() === login.toLowerCase()));
}
