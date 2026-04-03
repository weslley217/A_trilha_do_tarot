export type UserRole = 'master' | 'player';

export type RoomStatus = 'waiting' | 'running' | 'finished';
export type GameMode = 'short' | 'long';
export type CardGroup = 'major' | 'wands' | 'cups' | 'swords' | 'pentacles';

export interface InternalUser {
  username: string;
  display_name: string;
  password: string;
  role: UserRole;
  active: boolean;
  created_at?: string;
}

export interface GameRoom {
  id: string;
  name: string;
  status: RoomStatus;
  game_mode?: GameMode;
  game_state?: GameState | null;
  turn_order: string[];
  current_turn_index: number;
  winner_username: string | null;
  created_by: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface RoomPlayer {
  id: string;
  room_id: string;
  username: string;
  chips: number;
  is_ready: boolean;
  joined_at: string;
  last_action_at: string;
}

export interface GameAction {
  id: number;
  room_id: string;
  actor_username: string;
  target_username: string | null;
  card_key: string | null;
  description: string;
  created_at: string;
}

export type CardEffect = {
  kind: string;
  [key: string]: unknown;
};

export interface TarotCard {
  id: string;
  arcana: string;
  name: string;
  symbol: string;
  palette: [string, string];
  group?: CardGroup;
  suit?: string;
  rank?: string;
  rules: TarotCardRule[];
}

export interface TarotCardRule {
  id: string;
  effect: CardEffect;
  effectText: string;
  flavorText: string;
  targetCount?: number;
  requiresOrderSelection?: boolean;
  isSecret?: boolean;
}

export interface DeckCard {
  uid: string;
  cardId: string;
}

export interface PlayerStatus {
  emperorShield?: boolean;
  emperorReflect?: boolean;
  loversLink?: { partner: string; type: 'points' | 'draw'; pending: boolean };
  chariotRetaliation?: boolean;
  targetImmunityUntilNextTurn?: boolean;
  skipTurns?: number;
  onResumePointDelta?: number;
  pendingPointPenaltyNextTurn?: number;
  extraDrawNextTurn?: number;
  isOut?: boolean;
}

export interface GameState {
  mode: GameMode;
  drawPile: DeckCard[];
  discardPile: DeckCard[];
  hands: Record<string, DeckCard[]>;
  statuses: Record<string, PlayerStatus>;
  currentCycle: number;
}

