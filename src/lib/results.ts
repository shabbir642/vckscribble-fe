import {
  MIN_TEAM_SIZE,
  TEAMS,
  type Award,
  type AwardId,
  type GameSummary,
  type Player,
  type RoomSettings,
  type SummaryPlayer,
  type Team,
  type TeamResult,
} from '../generated/contract';
import { GREETINGS, type Festive } from './season';

/**
 * The words of a finished game: award names, the headline, what a share says
 * and how the share picture reads aloud. No DOM and no assets, so the results
 * screen, the share card (shareCard.ts draws these and re-exports them) and a
 * plain node test all use the same code.
 */

/** The id of a summary made up on the client while the real one is on its way. */
export const FALLBACK_ID = 'fallback';

/** The most a share's text may be, link included: room to spare in any app's box. */
const SHARE_MAX = 240;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2.1s": a guess time, to a tenth of a second. */
export function formatSeconds(ms: number): string {
  return `${(Math.round(Math.max(0, ms) / 100) / 10).toFixed(1)}s`;
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
}

/**
 * How each of the server's awards is shown: its emoji, its name, what it is
 * for, and what won it ("5 likes", "2.1s"), from the award's value.
 */
export const AWARDS: Record<
  AwardId,
  { emoji: string; title: string; blurb: string; value: (v: number) => string }
> = {
  artist: {
    emoji: '🎨',
    title: 'Crowd favourite',
    blurb: 'Most 👍 on their drawings',
    value: (v) => count(v, 'like', 'likes'),
  },
  speedster: {
    emoji: '⚡',
    title: 'Fastest finger',
    blurb: 'Quickest right guess',
    value: formatSeconds,
  },
  sharpshooter: {
    emoji: '🎯',
    title: 'Sharpshooter',
    blurb: 'Most words guessed',
    value: (v) => count(v, 'word', 'words'),
  },
  storyteller: {
    emoji: '💡',
    title: 'Crystal clear',
    blurb: 'Drawings guessed the most',
    value: (v) => count(v, 'right guess', 'right guesses'),
  },
  // Not 🥇: next to a podium that reads as first place.
  trailblazer: {
    emoji: '🙋',
    title: 'First in',
    blurb: 'First to guess, most often',
    value: (v) => (v === 1 ? 'once' : v === 2 ? 'twice' : `${v} times`),
  },
};

/**
 * Stands in for the server's summary until it arrives, or if it never does:
 * the same players and ranks the server would list (everyone still here, and
 * anyone gone who scored), and nothing it alone knows: no awards, no drawing.
 * `teams` are the room's in a team game (null or empty otherwise): their
 * scores rank them, and each player is on the team of their seat.
 * Never recorded as a game (see records.ts).
 */
export function summaryFromPlayers(players: Player[], teams: readonly Team[] | null = null): GameSummary {
  const kept = players
    .map((p, joined) => ({ p, joined }))
    .filter(({ p }) => p.connected || p.score > 0)
    // Best first; at equal scores whoever is still here, then join order.
    .sort(
      (a, b) =>
        b.p.score - a.p.score ||
        Number(b.p.connected) - Number(a.p.connected) ||
        a.joined - b.joined,
    )
    .map(({ p }) => p);
  const teamGame = teams !== null && teams.length > 0;
  return {
    id: FALLBACK_ID,
    players: kept.map(
      (p): SummaryPlayer => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        score: p.score,
        // Competition ranking: two tied for first are both 1st, the next is 3rd.
        rank: 1 + kept.filter((o) => o.score > p.score).length,
        guessed: 0,
        firstGuesses: 0,
        fastestMs: null,
        drew: 0,
        solvedByOthers: 0,
        likes: 0,
        left: !p.connected,
      }),
    ),
    awards: [],
    best: null,
    rounds: 0,
    turns: 0,
    abandoned: false,
    mode: teamGame ? 'teams' : 'classic',
    teams: teamGame
      ? teams
          .map((t, order) => ({ t, order }))
          // Best first; at equal scores in the game's own order.
          .sort((a, b) => b.t.score - a.t.score || a.order - b.order)
          .map(
            ({ t }): TeamResult => ({
              id: t.id,
              name: t.name,
              score: t.score,
              rank: 1 + teams.filter((o) => o.score > t.score).length,
              memberIds: kept.filter((p) => (p.teamId ?? null) === t.id).map((p) => p.id),
            }),
          )
      : null,
  };
}

/** The top three, best first: who stands on the podium. */
export function podium(summary: GameSummary): SummaryPlayer[] {
  // Stable, so the server's order settles equal ranks.
  return [...summary.players].sort((a, b) => a.rank - b.rank).slice(0, 3);
}

/* ----------------------------------------------------------------- teams */

/**
 * A team game's teams, best first; null when everyone played for themselves
 * (or the summary came from a server that knew no teams).
 */
export function teamResults(summary: GameSummary): TeamResult[] | null {
  return summary.mode === 'teams' && summary.teams?.length ? summary.teams : null;
}

/** The team someone played for, in a team game. */
export function teamOf(summary: GameSummary, playerId: string | null): TeamResult | null {
  if (playerId === null) return null;
  return teamResults(summary)?.find((t) => t.memberIds.includes(playerId)) ?? null;
}

/** The teams on the podium: the best three, best first. */
export function teamPodium(summary: GameSummary): TeamResult[] {
  // Stable, so the server's order settles equal ranks.
  return [...(teamResults(summary) ?? [])].sort((a, b) => a.rank - b.rank).slice(0, 3);
}

/** For a team whose id this page doesn't know: no colour of its own. */
const UNKNOWN_TEAM = { emoji: '⭐', colour: '#f4f2ff' };

/**
 * How a team looks: its emoji and its colour, always shown together with its
 * name (which comes from the game: the host may have renamed it). The colour
 * is for fills, borders and stripes only, never text: as text on white or
 * indigo it fails contrast.
 */
export function teamLook(id: string): { emoji: string; colour: string } {
  const team = TEAMS.find((t) => t.id === id);
  return team ? { emoji: team.emoji, colour: team.colour } : UNKNOWN_TEAM;
}

/**
 * The teams that can't play the next game yet, with how many more players
 * each needs: the lobby's rule, every team needs MIN_TEAM_SIZE players here.
 * None in a game where everyone plays for themselves. `teams` are the room's
 * (the first `teamCount` of TEAMS, with the host's names).
 */
export function shortTeams(
  settings: Pick<RoomSettings, 'mode' | 'teamCount'>,
  players: readonly Player[],
  teams: readonly Team[],
): { name: string; needs: number }[] {
  if (settings.mode !== 'teams') return [];
  const playing = teams.length ? teams : TEAMS.slice(0, settings.teamCount);
  return playing.flatMap((t) => {
    const here = players.filter((p) => p.connected && (p.teamId ?? null) === t.id).length;
    return here < MIN_TEAM_SIZE ? [{ name: t.name, needs: MIN_TEAM_SIZE - here }] : [];
  });
}

/**
 * Why the next game can't start yet, in the lobby's words (and the server's,
 * for one team): "Team Kiwi needs 1 more player", "Team Kiwi needs 1 more
 * player and Team Grape needs 2 more players".
 */
export function shortLine(short: readonly { name: string; needs: number }[]): string {
  const parts = short.map((t) => `${oneLine(t.name)} needs ${count(t.needs, 'more player', 'more players')}`);
  const last = parts.pop();
  if (last === undefined) return '';
  return parts.length ? `${parts.join(', ')} and ${last}` : last;
}

/** Names as one line of plain text (a stray newline would break a share). */
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * A web address, or near enough: a scheme, a dotted IP, or a dot between a
 * letter or digit and two letters ("bit.ly", "upi-refund.in/claim"). Chat
 * apps and X turn those into live links, and a player's name or word must
 * never become a link in someone else's message. Generous on purpose: a name
 * like "Dr.Who" counts too, and costs only a plainer sentence.
 */
const LINK = /:\/\/|[\p{L}\p{N}\p{M}_-]\.\p{L}[\p{L}\p{M}]|\d{1,3}(?:\.\d{1,3}){3}/u;
/** Dots some apps read as one in an address (ideographic, fullwidth and the like). */
const DOT_LIKE = /[\u2024\u3002\ufe52\uff0e\uff61]/g;

/** Whether `s` reads as a link once invisible characters are gone. */
function linkLike(s: string): boolean {
  return LINK.test(s.replace(/\p{Cf}/gu, '').replace(DOT_LIKE, '.'));
}

/**
 * The longest a headline naming tied winners may be. The picture gives the
 * headline two lines, and three long names (the server allows 20 characters)
 * would not fit them; past this, fewer names are written out.
 */
const NAMES_MAX = 60;

/** The big line on the share picture, and the first line of the message. */
export function headline(summary: GameSummary, youId: string | null): string {
  if (summary.abandoned) return 'Our Drawdle game ended early';
  const teams = teamResults(summary);
  if (teams) return teamHeadline(teams, youId);
  // Points win, not places: where nobody scored, everyone shares first place
  // and nobody won (the picture crowns nobody either).
  const winners = summary.players
    .filter((p) => p.rank === 1 && p.score > 0)
    .map((p) => oneLine(p.name));
  const you = youId === null ? undefined : summary.players.find((p) => p.id === youId);
  if (you && you.score > 0) {
    if (you.rank === 1) {
      return winners.length > 1 ? 'We tied for first at Drawdle!' : 'I won at Drawdle!';
    }
    if (you.rank === 2 || you.rank === 3) return `I came ${ordinal(you.rank)} at Drawdle!`;
  }
  return winnersLine(winners, ['other', 'others']);
}

/**
 * A team game's headline: the team's win is yours to share, and anyone
 * else names the winners. As for players, a team wins only with points.
 */
function teamHeadline(teams: TeamResult[], youId: string | null): string {
  const winners = teams.filter((t) => t.rank === 1 && t.score > 0);
  const yours = youId === null ? undefined : teams.find((t) => t.memberIds.includes(youId));
  if (yours && winners.includes(yours)) {
    return winners.length > 1 ? 'We tied for first at Drawdle!' : 'My team won at Drawdle!';
  }
  return winnersLine(
    winners.map((t) => oneLine(t.name)),
    ['other team', 'other teams'],
  );
}

/**
 * "Ann won our Drawdle game!", or the winners of a tie; "We played Drawdle!"
 * when nobody won. `others` names winners left unnamed: "2 others", "2 other teams".
 */
function winnersLine(winners: string[], others: [one: string, many: string]): string {
  const [a, b, c] = winners;
  if (a === undefined) return 'We played Drawdle!';
  let named: string[];
  let text: string;
  if (b === undefined) {
    named = [a];
    text = `${a} won our Drawdle game!`;
  } else if (c === undefined) {
    // Two names fit the picture, however long.
    named = [a, b];
    text = `${a} and ${b} tied for first!`;
  } else {
    // "A, B and C", or "A, B and 2 others"; when that is too long, "A and 3 others".
    named = winners.length === 3 ? [a, b, c] : [a, b];
    text = tied(named, winners.length - named.length, others);
    if (text.length > NAMES_MAX) {
      named = [a];
      text = tied(named, winners.length - 1, others);
    }
  }
  // Someone who named themselves (or their team) after a link gets no free
  // advert: the sentence goes plain rather than carry it into the sharer's chats.
  return named.some(linkLike) ? 'We played Drawdle!' : text;
}

/** "A, B and C tied for first!", or with the rest counted: "A and 2 others tied for first!". */
function tied(names: string[], rest: number, [one, many]: [string, string]): string {
  const list = rest ? [...names, count(rest, one, many)] : names;
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1] ?? ''} tied for first!`;
}

/** As a sentence: a full stop unless it already ends in one of its own (or an ellipsis). */
const sentence = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`);

const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/**
 * Characters as a reader sees them, so shortening a name never splits an
 * emoji or a Devanagari syllable (code points where Intl.Segmenter is missing).
 */
export function graphemes(s: string): string[] {
  return segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : [...s];
}

/**
 * At most `max` long (in string length, the unit SHARE_MAX counts in), ending
 * in an ellipsis when it had to be shortened.
 */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = '';
  for (const g of graphemes(s)) {
    if (out.length + g.length + 1 > max) break;
    out += g;
  }
  return `${out.trimEnd()}…`;
}

/**
 * The message that travels with the picture: one line each for the headline,
 * the drawing of the game and the link, at most SHARE_MAX characters. `join`
 * invites to this room (private chats); otherwise it points at the site
 * (public posts, where a live room code has no business being). A festive
 * game's message opens with the festival's greeting when there is room for it.
 */
export function shareText(
  summary: GameSummary,
  youId: string | null,
  url: string,
  join: boolean,
  festive: Festive = null,
): string {
  const text = message(summary, youId, url, join);
  if (!festive) return text;
  // Only into room to spare: the greeting never costs the message a word.
  const greeted = `${GREETINGS[festive]} ${text}`;
  return greeted.length <= SHARE_MAX ? greeted : text;
}

/** The message, greeting aside. */
function message(summary: GameSummary, youId: string | null, url: string, join: boolean): string {
  const cta = `${join ? 'Join our next game:' : 'Play free with friends:'} ${url}`;
  const head = sentence(headline(summary, youId));
  const best = summary.best;
  // A shortened name already ends in an ellipsis, and wants no full stop after it.
  const bestLine = (word: string, name: string) => `Best drawing: “${word}” by ${sentence(name)}`;
  // No line for a word or a name that a chat app would turn into a link.
  const tries =
    best && !linkLike(best.word) && !linkLike(best.drawerName)
      ? [
          bestLine(oneLine(best.word), oneLine(best.drawerName)),
          // Long names and phrases shortened before the line is given up.
          bestLine(clip(oneLine(best.word), 24), clip(oneLine(best.drawerName), 12)),
        ]
      : [];
  for (const line of tries) {
    const text = `${head}\n${line}\n${cta}`;
    if (text.length <= SHARE_MAX) return text;
  }
  const text = `${head}\n${cta}`;
  if (text.length <= SHARE_MAX) return text;
  // Only a very long link gets here: keep it whole, and as much headline as fits.
  const room = SHARE_MAX - cta.length - 1;
  return room >= 12 ? `${clip(head, room)}\n${cta}` : cta;
}

/** Who the picture's chips celebrate: at most two (a classic game's podium winner last). */
export function cardAwards(summary: GameSummary): Award[] {
  const rank = new Map(summary.players.map((p) => [p.id, p.rank]));
  const known = summary.awards.filter((a) => rank.has(a.playerId));
  const teams = teamResults(summary);
  if (teams) return teamCardAwards(known, teams);
  // The winner is already crowned on the podium; the chips are the others' moment.
  const others = known.filter((a) => rank.get(a.playerId) !== 1);
  const picked: Award[] = [];
  // Two different people before anyone's second award.
  for (const a of others) {
    if (picked.length < 2 && !picked.some((p) => p.playerId === a.playerId)) picked.push(a);
  }
  for (const a of [...others, ...known]) {
    if (picked.length < 2 && !picked.includes(a)) picked.push(a);
  }
  return picked;
}

/**
 * A team game's podium crowns teams, not players, so any award may make the
 * picture: two different people, and from two different teams where the
 * awards allow (a picture shared to the whole office celebrates both sides).
 */
function teamCardAwards(awards: Award[], teams: TeamResult[]): Award[] {
  const team = (a: Award) => teams.find((t) => t.memberIds.includes(a.playerId))?.id;
  const picked: Award[] = [];
  const passes: ((a: Award) => boolean)[] = [
    (a) => !picked.some((p) => p.playerId === a.playerId || team(p) === team(a)),
    (a) => !picked.some((p) => p.playerId === a.playerId),
    () => true,
  ];
  for (const ok of passes) {
    for (const a of awards) {
      if (picked.length < 2 && !picked.includes(a) && ok(a)) picked.push(a);
    }
  }
  return picked;
}

/** The share picture in words, for its alt text: what it shows, in reading order. */
export function cardAlt(summary: GameSummary, youId: string | null, festive: Festive = null): string {
  const name = (id: string) => oneLine(summary.players.find((p) => p.id === id)?.name ?? 'Someone');
  const parts = [`Drawdle results picture: ${sentence(headline(summary, youId))}`];
  // The sticker by the headline.
  if (festive) parts.push(GREETINGS[festive]);
  const best = summary.best;
  if (best) {
    const by = `“${oneLine(best.word)}” drawn by ${oneLine(best.drawerName)}`;
    const likes = best.likes > 0 ? `, ${count(best.likes, 'like', 'likes')}` : '';
    parts.push(`Drawing of the game: ${by}${likes}.`);
  }
  // A team game's podium has the teams on it.
  const top = teamResults(summary) ? teamPodium(summary) : podium(summary);
  if (top.length) {
    // As the picture shows them: a place only for those who scored.
    const places = top.map((p) => {
      const place = p.score > 0 ? `${ordinal(p.rank)} ` : '';
      return `${place}${oneLine(p.name)}, ${count(p.score, 'point', 'points')}`;
    });
    parts.push(`Podium: ${places.join('; ')}.`);
  }
  const awards = cardAwards(summary);
  if (awards.length) {
    const won = awards.map((a) => {
      const award = AWARDS[a.id];
      return `${award.title}, ${name(a.playerId)}, ${award.value(a.value)}`;
    });
    parts.push(`${awards.length === 1 ? 'Award' : 'Awards'}: ${won.join('; ')}.`);
  }
  parts.push('Play free at drawdle.in.');
  return parts.join(' ');
}
