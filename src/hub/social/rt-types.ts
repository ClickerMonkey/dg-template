/**
 * Wire shapes for the hub's social + multiplayer layer — the single source of
 * truth for multiplayer-impl.md §4 (WebSocket), §5 (REST) and §6 (rooms).
 *
 * TYPES ONLY. This file is imported by the vendorable `clients/hub.ts` (as
 * `import type`) and by the runtime bundle `/_hub/social.js`. It must never
 * contain runtime code, so vendoring it costs zero bytes and the two bundles
 * can never drift on what the server sends.
 *
 * It also declares `RealtimeApi`, the object `/_hub/social.js` installs on
 * `window.__HUB_RT__`; `hub.ts`'s thin namespaces forward to it.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Effective chat mode for a conversation/room (§3.5): free text, phrases only, or nothing. */
export type ChatMode = 'on' | 'quick' | 'off';

/** Who may see my presence / message me. */
export type Audience = 'friends' | 'nobody';

/** The public face of a player — all other players ever see of an account. */
export interface PlayerLite {
  id: number;
  username: string;
  /** Preset avatar id (`a0`…`a23`). */
  avatar: string;
  guest: boolean;
}

/** Error body of a failed REST call or WS ack (`{error, code?, reason?, hint?, retryAfterMs?}`). */
export interface ErrorBody {
  error: string;
  code?: string;
  reason?: string;
  hint?: string;
  retryAfterMs?: number;
}

/**
 * What a rejected social call throws. Both bundles produce errors with these
 * fields; `hub.ts` re-wraps them into its own `HubError` /
 * `ContentRejectedError` so `instanceof` works against the game's copy.
 */
export interface RtErrorShape extends Error {
  /** HTTP status (REST) or undefined (transport/WS). */
  status?: number;
  code?: string;
  reason?: string;
  hint?: string;
  retryAfterMs?: number;
}

// ---------------------------------------------------------------------------
// Presence (§4.4)
// ---------------------------------------------------------------------------

/** Activity kinds, most engaged first: playing > watching > lobby > menu > away. */
export type PresenceKind = 'menu' | 'lobby' | 'playing' | 'watching' | 'away';

/** What a game reports via `hub.presence.set`. */
export interface PresenceInput {
  kind: PresenceKind;
  /** ≤40 chars, filtered server-side; dropped silently on reject. */
  detail?: string;
  joinable?: boolean;
  watchable?: boolean;
  /** Opaque join info (≤64, `[A-Za-z0-9_:-]`), visible to friends. */
  room?: string;
  /** Room is public → may trigger `lobby_open` notifications. */
  public?: boolean;
  openSeats?: number;
  mode?: string;
}

/** A user's aggregated presence as friends see it. */
export interface Presence extends PresenceInput {
  game: string | null;
  gameTitle: string | null;
  /** Epoch ms when this activity started. */
  since: number;
  partySize?: number;
}

/** Online counts: everyone (guests included), and per game slug. */
export interface Counts {
  online: number;
  byGame: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Account + config (§4.5, §5.1)
// ---------------------------------------------------------------------------

/** The signed-in player's own social settings (snapshot `me`, GET/PUT /social/me). */
export interface SocialMe extends PlayerLite {
  role: 'admin' | '';
  privacy: Audience;
  dmPolicy: Audience;
  chatLock: boolean;
  /** Epoch ms until which free text is muted (0 = not muted). */
  mutedUntil: number;
  /** Epoch ms until which the account is suspended (0/absent = not suspended). */
  suspendedUntil?: number;
  suspendReason?: string;
}

/** Site-wide social configuration (GET /social/config, ev:config). */
export interface SocialConfig {
  chatMode: ChatMode;
  /** True when the AI safety reviewer is configured. */
  ai: boolean;
  contactUrl: string;
  parentsUrl: string;
  vapidPublicKey: string;
  /** Quick-chat id → text (hub phrases, emotes `e:<emoji>`, game phrases). */
  quickChat: Record<string, string>;
  /** The emote emoji (also in `quickChat` as `e:<emoji>` ids). */
  emotes: string[];
  limits: { dmMaxChars: number; roomChatMaxChars: number; suggestionTitleMax: number; suggestionBodyMax: number };
  /** Preset avatar ids. */
  avatars: string[];
  /** Present (true) only when the host runs with HUB_TEST=1; enables `window.__HUB_TEST__`. */
  test?: boolean;
}

/** Notification preferences (GET/PUT /social/notify). */
export interface NotifyPrefs {
  dm: boolean;
  friend_request: boolean;
  /** Friend ids with "tell me when they're online" on. */
  friendOnline: number[];
  /** Game slugs with "someone's waiting in a lobby" on. */
  lobbyOpen: string[];
}

/** One `PUT /social/notify` change. `target` = friend id (as string) or game slug. */
export interface NotifyChange {
  kind: 'dm' | 'friend_request' | 'friend_online' | 'lobby_open';
  target?: string;
  enabled: boolean;
}

/** GET /social/me. */
export interface SocialMeResponse {
  me: SocialMe;
  notify: NotifyPrefs;
  pushSubs: number;
}

// ---------------------------------------------------------------------------
// Friends & players (§5.1)
// ---------------------------------------------------------------------------

/** A friend with live presence. */
export interface FriendEntry extends PlayerLite {
  presence: Presence | null;
  notifyOnline: boolean;
  since: number;
  lastSeenAt: number;
}

/** My relationship to another player. */
export type Relation = 'self' | 'friend' | 'incoming' | 'outgoing' | 'blocked' | 'none';

/** GET /social/players/:id. */
export interface PlayerCard extends PlayerLite {
  relation: Relation;
  /** Friends only. */
  presence: Presence | null;
  canFriend: boolean;
  canMessage: boolean;
  canInvite: boolean;
  canReport: boolean;
}

/** GET /social/friends. */
export interface FriendsResponse {
  friends: FriendEntry[];
  incoming: PlayerLite[];
  outgoing: PlayerLite[];
  blocked: PlayerLite[];
}

/** A "people you played with" row (GET /social/recent). */
export interface RecentPlayer extends PlayerLite {
  game: string;
  lastAt: number;
}

// ---------------------------------------------------------------------------
// Messages (§5.2)
// ---------------------------------------------------------------------------

/** A direct message. `text` is the delivered (possibly softened) text, '' for quick. */
export interface Message {
  id: number;
  from: number;
  to: number;
  text: string;
  quick?: string;
  at: number;
  read: boolean;
  softened?: boolean;
}

/** A conversation summary (GET /social/conversations). */
export interface Conversation {
  user: PlayerLite;
  last: Message;
  unread: number;
}

/** GET /social/messages/:userId. */
export interface MessagesPage {
  messages: Message[];
  more: boolean;
  mode: ChatMode;
}

// ---------------------------------------------------------------------------
// Reports, suggestions (§5.3, §5.5)
// ---------------------------------------------------------------------------

export type ReportKind = 'message' | 'user' | 'username' | 'suggestion' | 'room_chat' | 'presence';
export type ReportReason = 'mean' | 'bad_words' | 'personal' | 'inappropriate' | 'spam' | 'other';

/** POST /social/reports body. */
export interface ReportInput {
  kind: ReportKind;
  targetUserId: number;
  refId?: string;
  reason: ReportReason;
}

export type SuggestionStatus = 'pending' | 'approved' | 'planned' | 'done' | 'removed' | 'withdrawn';

/** A game suggestion. `author` only for approved+. */
export interface Suggestion {
  id: number;
  title: string;
  body: string;
  status: SuggestionStatus;
  votes: number;
  voted: boolean;
  mine: boolean;
  adminNote: string;
  createdAt: number;
  author?: string;
}

/** GET /suggestions. */
export interface SuggestionsResponse {
  approved: Suggestion[];
  mine: Suggestion[];
}

// ---------------------------------------------------------------------------
// Multiplayer: invites, parties, launches (§5.6)
// ---------------------------------------------------------------------------

/** A pending invite addressed to (or sent by) me. */
export interface Invite {
  id: string;
  from: PlayerLite;
  to: PlayerLite;
  game: string;
  gameTitle: string;
  mode?: string;
  partyId: string;
  expiresAt: number;
}

/** A group of friends moving between games together. */
export interface Party {
  id: string;
  game: string;
  mode?: string;
  leaderId: number;
  members: PlayerLite[];
  joinInfo: Record<string, string> | null;
  createdAt: number;
}

/** What a game receives in `hub.mp.onLaunch` when the hub brings a player in. */
export interface Launch {
  kind: 'host' | 'guest' | 'join' | 'watch';
  game: string;
  mode?: string;
  partyId?: string;
  party?: Party;
  joinInfo?: Record<string, string> | null;
  room?: string;
  host?: PlayerLite;
  target?: PlayerLite;
}

/** POST /mp/invites. */
export interface InviteCreated {
  invite: Invite;
  launchToken: string;
  url: string;
}

/** A launch token + the URL that redeems it (accept, join, watch). */
export interface LaunchTicket {
  launchToken: string;
  url: string;
}

/** `hub.mp.onJoinInfo` payload: the party leader published where to connect. */
export interface JoinInfoEvent {
  partyId: string;
  info: Record<string, string>;
}

/** A game's `game.multiplayer` block as exposed by GET /games (null when absent). */
export interface GameMultiplayer {
  lobby?: string;
  players?: [number, number];
  transport?: 'hub-rooms' | 'own-server';
  invites?: boolean;
  join?: boolean;
  spectate?: boolean;
  modes?: { key: string; title: string; players?: [number, number] }[];
}

/** One GET /games row, including the multiplayer block. */
export interface CatalogGame {
  slug: string;
  title: string;
  path: string;
  hubEnabled: boolean;
  multiplayer?: GameMultiplayer | null;
}

// ---------------------------------------------------------------------------
// Hub relay rooms (§6)
// ---------------------------------------------------------------------------

/** A seat in a hub room. */
export interface RoomSeat {
  userId: number;
  name: string;
  avatar: string;
  ready: boolean;
  connected: boolean;
  /** Small per-seat game data (≤2 KB). */
  data?: unknown;
}

/** Public room description (ev:room, room.* acks). */
export interface RoomInfo {
  id: string;
  code: string;
  game: string;
  mode?: string;
  hostId: number;
  public: boolean;
  phase: 'lobby' | 'playing' | 'ended';
  maxPlayers: number;
  model: 'host' | 'relay';
  seats: RoomSeat[];
  spectators: number;
  chatMode: ChatMode;
}

/** Options for `hub.rooms.create`. `game` defaults to the current slug. */
export interface RoomCreateOptions {
  game?: string;
  mode?: string;
  public?: boolean;
  maxPlayers?: number;
  model?: 'host' | 'relay';
  partyId?: string;
}

/** A relayed game message (ev:room.msg). */
export interface RoomMessage {
  from: number;
  data: unknown;
  seq: number;
  /** Set when the message was addressed to one seat (`send(data, {to})`). */
  to?: number;
}

/** A shared-state change (ev:room.state). Patches are shallow-merged unless `replace`. */
export interface RoomStateChange {
  patch: Record<string, unknown>;
  replace: boolean;
  seq: number;
}

/** A moderated room chat line (ev:room.chat). */
export interface RoomChatLine {
  from: number;
  text: string;
  quick?: string;
}

/** Events a `HubRoom` emits, name → payload. */
export interface RoomEvents {
  room: RoomInfo;
  msg: RoomMessage;
  state: Record<string, unknown>;
  chat: RoomChatLine;
  kicked: { roomId: string };
  /**
   * reason: empty | ended | host_left | other_tab | moved | removed, or
   * `gone` (client-side: the seat couldn't be reclaimed after a reconnect,
   * e.g. the host restarted).
   */
  closed: { reason: string };
  /** The host ended the match (phase → 'ended'); `results` is what it passed to `end()`, if anything. Fires once. */
  ended: { room: RoomInfo; results?: unknown };
  abandoned: { userId: number; reason?: string };
}

/** A live hub relay room, as games see it. */
export interface HubRoom {
  readonly info: RoomInfo;
  /** The shared room state (≤32 KB). */
  readonly state: Record<string, unknown>;
  /** Who I am in this room. */
  readonly me: { userId: number; host: boolean; spectator: boolean };
  on<E extends keyof RoomEvents>(ev: E, cb: (d: RoomEvents[E]) => void): () => void;
  ready(ready: boolean): Promise<void>;
  seat(data: unknown): Promise<void>;
  start(): Promise<void>;
  send(data: unknown, opts?: { to?: number }): Promise<void>;
  setState(patch: Record<string, unknown>, opts?: { replace?: boolean }): Promise<void>;
  /** Free-text chat; resolves to the delivered (maybe softened) text, rejects with a content rejection. */
  chat(text: string): Promise<string>;
  quick(phraseId: string): Promise<void>;
  kick(userId: number): Promise<void>;
  leave(): Promise<void>;
  end(results?: unknown): Promise<void>;
}

// ---------------------------------------------------------------------------
// WebSocket envelope + snapshot + events (§4.2, §4.5, §4.6)
// ---------------------------------------------------------------------------

/** client → server. */
export interface OpEnvelope { t: 'op'; id: number; op: string; d?: unknown }
/** server → client: an op's answer. */
export type AckEnvelope =
  | { t: 'ack'; id: number; ok: true; d?: unknown }
  | { t: 'ack'; id: number; ok: false; err: ErrorBody };
/** server → client: a pushed event. */
export interface EventEnvelope { t: 'ev'; ev: string; d?: unknown }

/** `hello` ack: everything the drawer needs in one round-trip. */
export interface Snapshot {
  me: SocialMe;
  config: SocialConfig;
  counts: Counts;
  friends: FriendEntry[];
  requests: { incoming: PlayerLite[]; outgoing: PlayerLite[] };
  unread: { dms: number; byUser: Record<string, number> };
  invites: Invite[];
  party: Party | null;
  /** The hub-room seat I still hold (reconnect by joining it again). */
  room?: RoomInfo | null;
}

/** A generic server notice rendered as a toast (ev:notice). */
export interface Notice {
  kind: string;
  title: string;
  body?: string;
  action?: { label: string; url?: string; op?: string };
}

/** Server events, name → payload (room.* events are in {@link RoomEvents}). */
export interface ServerEvents {
  presence: { userId: number; p: Presence | null };
  counts: Counts;
  /** `restored`: a friend's suspension ended (refetch; no toast). */
  friends: { change: 'request' | 'accepted' | 'removed' | 'declined' | 'cancelled' | 'blocked' | 'restored'; user: PlayerLite };
  dm: { message: Message; conversationWith: number };
  'dm.read': { by: number; upTo: number };
  'dm.hidden': { ids: number[] };
  typing: { from: number };
  invite: Invite;
  /** Sent to the inviter and the invitee (so its toast closes). */
  'invite.update': { id: string; status: 'accepted' | 'declined' | 'expired' | 'cancelled'; by?: PlayerLite };
  party: Party | null;
  /** Party chat line (op `party.chat`; free text only when all members are mutual friends). */
  'party.chat': { from: number; text: string; quick?: string; softened?: boolean };
  notice: Notice;
  config: SocialConfig;
  suspended: { until: number; reason?: string };
  /** `results` is present once, on room.end. */
  room: { room: RoomInfo; results?: unknown };
  'room.msg': RoomMessage;
  'room.state': RoomStateChange;
  'room.chat': RoomChatLine;
  'room.kicked': { roomId: string };
  'room.closed': { reason: string };
  'room.abandoned': { userId: number; reason?: string };
}

// ---------------------------------------------------------------------------
// The runtime API on window.__HUB_RT__ (§7.2)
// ---------------------------------------------------------------------------

/** Counts as a game sees them. */
export interface SocialCounts {
  /** Everyone online on the site. */
  online: number;
  /** Players in the current game (0 on the catalog page). */
  inGame: number;
  /** My friends currently online. */
  friendsOnline: number;
}

/** Events games can subscribe to via `hub.social.on`. */
export interface SocialEvents {
  friends: FriendEntry[];
  presence: { userId: number; p: Presence | null };
  counts: SocialCounts;
  invite: Invite;
  party: Party | null;
}

/** Who to open a player card for. */
export type PlayerRef = { userId: number } | { username: string };

/** Result of `hub.mp.invite`. */
export interface InviteResult {
  invite: Invite;
}

/**
 * Installed by `/_hub/social.js` as `window.__HUB_RT__`. Versioned so a
 * vendored `hub.ts` can feature-detect newer additions.
 */
export interface RealtimeApi {
  readonly version: number;
  presence: {
    set(p: PresenceInput): void;
    /** Back to `{kind:'menu'}`. */
    clear(): void;
  };
  social: {
    openPlayer(ref: PlayerRef): void;
    openFriends(): void;
    openChat(userId: number): void;
    openInvite(opts?: { userId?: number; mode?: string }): void;
    openSuggest(): void;
    openNotify(opts?: { game?: string }): void;
    friends(): Promise<FriendEntry[]>;
    counts(): SocialCounts;
    /** Effective mode with these participants (me + friends), or the site mode when omitted. */
    chatMode(userIds?: number[]): ChatMode;
    on<E extends keyof SocialEvents>(ev: E, cb: (d: SocialEvents[E]) => void): () => void;
  };
  mp: {
    /** Launches are buffered until the first listener registers. */
    onLaunch(cb: (l: Launch) => void): () => void;
    onJoinInfo(cb: (e: JoinInfoEvent) => void): () => void;
    invite(userId: number, opts?: { mode?: string }): Promise<InviteResult>;
    setBusy(busy: boolean, opts?: { label?: string }): void;
    ticket(): Promise<string>;
    setJoinInfo(partyId: string, info: Record<string, string>): Promise<void>;
    party(): Party | null;
  };
  rooms: {
    create(opts?: RoomCreateOptions): Promise<HubRoom>;
    join(codeOrId: string, opts?: { spectate?: boolean }): Promise<HubRoom>;
    list(opts?: { mode?: string }): Promise<RoomInfo[]>;
  };
  notify: {
    /** Quiet: toasts collapse into the badge (invites still show as a small pill). */
    setQuiet(quiet: boolean): void;
  };
}
