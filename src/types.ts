export type UserRole = 'master' | 'player';

export type RoomStatus = 'waiting' | 'running' | 'finished';

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

export type CardEffect =
  | { kind: 'self_delta'; amount: number }
  | { kind: 'target_delta'; amount: number; requiresTarget: true }
  | { kind: 'steal'; amount: number; requiresTarget: true }
  | { kind: 'give'; amount: number; requiresTarget: true }
  | { kind: 'both_delta'; actorAmount: number; targetAmount: number; requiresTarget: true }
  | { kind: 'richest_to_actor'; amount: number }
  | { kind: 'self_and_others'; actorAmount: number; othersAmount: number }
  | { kind: 'random_actor_delta'; min: number; max: number }
  | { kind: 'actor_gain_from_all'; amountEach: number }
  | { kind: 'all_delta'; amount: number };

export interface TarotCard {
  id: string;
  arcana: string;
  name: string;
  symbol: string;
  palette: [string, string];
  effect: CardEffect;
  effectText: string;
  meaning: string;
}

