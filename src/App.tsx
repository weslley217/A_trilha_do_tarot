
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CardGroup,
  DeckCard,
  GameAction,
  GameMode,
  GameRoom,
  GameState,
  InternalUser,
  PlayerStatus,
  RoomPlayer,
  TarotCard,
  TarotCardRule,
} from './types';
import { isUsingSupabaseFallback, supabase } from './supabase';
import { MAJOR_ARCANA_IDS, TAROT_CARDS } from './data/tarotCards';

const WIN_TARGET = 10;
const SESSION_KEY = 'tarot-session-user-v1';
const INITIAL_HAND_DRAW = 0;
const WHEEL_SLOTS = [-3, -2, -1, 1, 2, 3, 4, 5, 6];

const HAND_TABS: Array<{ id: 'all' | CardGroup; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'major', label: 'Arcanos Maiores' },
  { id: 'wands', label: 'Paus' },
  { id: 'cups', label: 'Copas' },
  { id: 'swords', label: 'Espadas' },
  { id: 'pentacles', label: 'Ouros' },
];

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function makeUid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatSigned(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

function stripActionMeta(description: string): string {
  return description
    .replace(/\s*::WHEEL:[+-]?\d+/gi, '')
    .replace(/\s*::DECK_RESET/gi, '')
    .replace(/\s*::MODE:(short|long)/gi, '')
    .replace(/\s*::STATE:[^\s]+/gi, '')
    .replace(/\s*::STATE_RESET/gi, '')
    .trim();
}

function encodeStateToken(state: GameState): string {
  return encodeURIComponent(JSON.stringify(state));
}

function decodeStateToken(token: string): GameState | null {
  try {
    const decoded = decodeURIComponent(token);
    const parsed = JSON.parse(decoded) as GameState;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function extractModeToken(description: string): GameMode | null {
  const match = description.match(/::MODE:(short|long)/i);
  if (!match) return null;
  const value = match[1]?.toLowerCase();
  return value === 'long' ? 'long' : value === 'short' ? 'short' : null;
}

function extractStateToken(description: string): GameState | null {
  const match = description.match(/::STATE:([^\s]+)/i);
  if (!match?.[1]) return null;
  return decodeStateToken(match[1]);
}

function isMissingRoomStateColumnsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as { code?: string; message?: string };
  const message = `${maybe.message ?? ''}`.toLowerCase();
  return (
    maybe.code === '42703' &&
    (message.includes('game_mode') || message.includes('game_state'))
  );
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function cloneGameState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function buildDeck(mode: GameMode): DeckCard[] {
  const source = mode === 'short'
    ? TAROT_CARDS.filter((card) => MAJOR_ARCANA_IDS.has(card.id))
    : TAROT_CARDS;

  return shuffle(
    source.map((card) => ({
      uid: makeUid(card.id),
      cardId: card.id,
    }))
  );
}

function ensureStatus(state: GameState, username: string): PlayerStatus {
  if (!state.statuses[username]) state.statuses[username] = {};
  return state.statuses[username];
}

function drawCards(state: GameState, username: string, count: number) {
  if (!state.hands[username]) state.hands[username] = [];
  for (let i = 0; i < count; i += 1) {
    if (state.drawPile.length === 0) break;
    const next = state.drawPile.shift();
    if (next) state.hands[username].push(next);
  }
}

function initializeGameState(mode: GameMode, usernames: string[]): GameState {
  const gameState: GameState = {
    mode,
    drawPile: buildDeck(mode),
    discardPile: [],
    hands: {},
    statuses: {},
    currentCycle: 1,
  };

  usernames.forEach((username) => {
    gameState.hands[username] = [];
    gameState.statuses[username] = {};
  });

  usernames.forEach((username) => {
    drawCards(gameState, username, INITIAL_HAND_DRAW);
  });

  return gameState;
}

function normalizeRoomGameState(input: unknown, mode: GameMode, usernames: string[]): GameState {
  const fallback = initializeGameState(mode, usernames);
  if (!input || typeof input !== 'object') return fallback;

  const raw = input as Partial<GameState>;
  const state: GameState = {
    mode: (raw.mode as GameMode) || mode,
    drawPile: Array.isArray(raw.drawPile) ? raw.drawPile : fallback.drawPile,
    discardPile: Array.isArray(raw.discardPile) ? raw.discardPile : [],
    hands: typeof raw.hands === 'object' && raw.hands ? raw.hands : {},
    statuses: typeof raw.statuses === 'object' && raw.statuses ? raw.statuses : {},
    currentCycle: typeof raw.currentCycle === 'number' ? raw.currentCycle : 1,
  };

  usernames.forEach((username) => {
    if (!Array.isArray(state.hands[username])) state.hands[username] = [];
    if (!state.statuses[username]) state.statuses[username] = {};
  });

  return state;
}

function App() {
  const [users, setUsers] = useState<InternalUser[]>([]);
  const [sessionUser, setSessionUser] = useState<InternalUser | null>(null);
  const [isBootLoading, setIsBootLoading] = useState(true);
  const [loginName, setLoginName] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [rooms, setRooms] = useState<GameRoom[]>([]);
  const [memberRoomIds, setMemberRoomIds] = useState<string[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<GameRoom | null>(null);
  const [roomPlayers, setRoomPlayers] = useState<RoomPlayer[]>([]);
  const [actions, setActions] = useState<GameAction[]>([]);

  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomMode, setNewRoomMode] = useState<GameMode>('short');
  const [roomModeDraft, setRoomModeDraft] = useState<GameMode>('short');
  const [playerToAdd, setPlayerToAdd] = useState('');

  const [newUserLogin, setNewUserLogin] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('1234');

  const [selectedCardUid, setSelectedCardUid] = useState<string | null>(null);
  const [selectedRule, setSelectedRule] = useState<TarotCardRule | null>(null);
  const [selectedTargetA, setSelectedTargetA] = useState('');
  const [selectedTargetB, setSelectedTargetB] = useState('');
  const [selectedDiscardUid, setSelectedDiscardUid] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<string[]>([]);
  const [handTab, setHandTab] = useState<'all' | CardGroup>('all');
  const [revealedHands, setRevealedHands] = useState<Record<string, boolean>>({});
  const [supportsRoomStateColumns, setSupportsRoomStateColumns] = useState<boolean | null>(null);

  const [isMutating, setIsMutating] = useState(false);
  const [uiMessage, setUiMessage] = useState('');

  const [liveAnimationActionId, setLiveAnimationActionId] = useState<number | null>(null);
  const [wheelSpinDegrees, setWheelSpinDegrees] = useState(0);
  const animationTimerRef = useRef<number | null>(null);
  const lastAnimatedActionIdRef = useRef<number | null>(null);
  const initializedRoomRef = useRef<string | null>(null);

  const cardsById = useMemo(() => {
    const map = new Map<string, TarotCard>();
    TAROT_CARDS.forEach((card) => map.set(card.id, card));
    return map;
  }, []);

  const userMap = useMemo(() => {
    const map = new Map<string, InternalUser>();
    users.forEach((user) => map.set(user.username, user));
    return map;
  }, [users]);

  const visibleRooms = useMemo(() => {
    if (!sessionUser) return [];
    if (sessionUser.role === 'master') return rooms;
    const set = new Set(memberRoomIds);
    return rooms.filter((room) => set.has(room.id));
  }, [memberRoomIds, rooms, sessionUser]);

  const fallbackModeFromActions = useMemo(() => {
    for (const action of actions) {
      const mode = extractModeToken(action.description);
      if (mode) return mode;
    }
    return null;
  }, [actions]);

  const roomMode: GameMode = (selectedRoom?.game_mode as GameMode) || fallbackModeFromActions || 'short';
  const roomUsernames = useMemo(() => roomPlayers.map((p) => p.username), [roomPlayers]);
  const fallbackStateFromActions = useMemo(() => {
    for (const action of actions) {
      if (action.description.includes('::STATE_RESET')) return null;
      const state = extractStateToken(action.description);
      if (state) return state;
    }
    return null;
  }, [actions]);

  const gameStateSource = supportsRoomStateColumns === false
    ? fallbackStateFromActions
    : selectedRoom?.game_state;

  const gameState = useMemo(
    () => normalizeRoomGameState(gameStateSource, roomMode, roomUsernames),
    [gameStateSource, roomMode, roomUsernames]
  );

  const roomPlayerMap = useMemo(() => {
    const map = new Map<string, RoomPlayer>();
    roomPlayers.forEach((player) => map.set(player.username, player));
    return map;
  }, [roomPlayers]);

  const currentTurnUsername = useMemo(() => {
    if (!selectedRoom || selectedRoom.status !== 'running') return null;
    const order = selectedRoom.turn_order ?? [];
    if (order.length === 0) return null;
    return order[selectedRoom.current_turn_index] ?? null;
  }, [selectedRoom]);

  const nextTurnUsername = useMemo(() => {
    if (!selectedRoom || selectedRoom.status !== 'running') return null;
    const order = selectedRoom.turn_order ?? [];
    if (order.length === 0) return null;
    return order[(selectedRoom.current_turn_index + 1) % order.length] ?? null;
  }, [selectedRoom]);

  const winnerName = selectedRoom?.winner_username
    ? userMap.get(selectedRoom.winner_username)?.display_name ?? selectedRoom.winner_username
    : null;
  const isCurrentUserTurn = Boolean(sessionUser && currentTurnUsername === sessionUser.username);
  const isPlayerInRoom = Boolean(sessionUser && roomPlayerMap.get(sessionUser.username));
  const allReady = roomPlayers.length > 0 && roomPlayers.every((player) => player.is_ready);
  const showVictoryCeremony = Boolean(selectedRoom?.status === 'finished' && winnerName);

  const myHandInstances = useMemo(() => {
    if (!sessionUser) return [];
    return gameState.hands[sessionUser.username] ?? [];
  }, [gameState.hands, sessionUser]);

  const availableDeckCards = useMemo(() => {
    return gameState.drawPile
      .map((instance) => ({ instance, card: cardsById.get(instance.cardId) }))
      .filter((entry): entry is { instance: DeckCard; card: TarotCard } => Boolean(entry.card))
      .filter((entry) => (handTab === 'all' ? true : entry.card.group === handTab));
  }, [cardsById, gameState.drawPile, handTab]);

  const selectedCard = useMemo(() => {
    if (!selectedCardUid) return null;
    const found = gameState.drawPile.find((item) => item.uid === selectedCardUid);
    if (!found) return null;
    const card = cardsById.get(found.cardId);
    if (!card) return null;
    return { instance: found, card };
  }, [cardsById, gameState.drawPile, selectedCardUid]);

  const liveAnimationAction = useMemo(() => {
    if (liveAnimationActionId == null) return null;
    return actions.find((action) => action.id === liveAnimationActionId) ?? null;
  }, [actions, liveAnimationActionId]);
  const liveAnimationCard = liveAnimationAction?.card_key
    ? cardsById.get(liveAnimationAction.card_key) ?? null
    : null;
  const liveAnimationActorName = liveAnimationAction
    ? userMap.get(liveAnimationAction.actor_username)?.display_name ?? liveAnimationAction.actor_username
    : '';
  const wheelMatch = liveAnimationAction?.description.match(/::WHEEL:([+-]?\d+)/i);
  const wheelResult = wheelMatch ? Number(wheelMatch[1]) : null;

  const toast = (message: string) => {
    setUiMessage(message);
    window.setTimeout(() => {
      setUiMessage((prev) => (prev === message ? '' : prev));
    }, 2600);
  };

  const fetchUsers = async () => {
    const { data, error } = await supabase
      .from('internal_users')
      .select('*')
      .eq('active', true)
      .order('display_name');
    if (error) throw error;
    return (data ?? []) as InternalUser[];
  };

  const fetchRooms = async () => {
    const { data, error } = await supabase
      .from('game_rooms')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as GameRoom[];
  };

  const fetchMembership = async (username: string) => {
    const { data, error } = await supabase
      .from('room_players')
      .select('room_id')
      .eq('username', username);
    if (error) throw error;
    return (data ?? []).map((row) => row.room_id as string);
  };

  const detectRoomStateColumnsSupport = async () => {
    const { error } = await supabase
      .from('game_rooms')
      .select('id,game_mode,game_state')
      .limit(1);

    if (!error) {
      setSupportsRoomStateColumns(true);
      return;
    }

    if (isMissingRoomStateColumnsError(error)) {
      setSupportsRoomStateColumns(false);
      return;
    }

    throw error;
  };
  const loadRoomData = async (roomId: string) => {
    const [{ data: roomData, error: roomError }, { data: playersData, error: playersError }, { data: actionsData, error: actionsError }] =
      await Promise.all([
        supabase.from('game_rooms').select('*').eq('id', roomId).maybeSingle(),
        supabase.from('room_players').select('*').eq('room_id', roomId).order('joined_at'),
        supabase.from('game_actions').select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(250),
      ]);

    if (roomError) throw roomError;
    if (playersError) throw playersError;
    if (actionsError) throw actionsError;

    const room = (roomData ?? null) as GameRoom | null;
    setSelectedRoom(room);
    setRoomPlayers((playersData ?? []) as RoomPlayer[]);
    setActions((actionsData ?? []) as GameAction[]);
  };

  const refreshBaseData = async (preferredRoomId?: string | null) => {
    if (!sessionUser) return;
    const [roomsData, membershipData] = await Promise.all([
      fetchRooms(),
      sessionUser.role === 'master' ? Promise.resolve<string[]>([]) : fetchMembership(sessionUser.username),
    ]);

    setRooms(roomsData);
    setMemberRoomIds(membershipData);

    const allowed = sessionUser.role === 'master'
      ? roomsData
      : roomsData.filter((room) => membershipData.includes(room.id));
    const preferred = preferredRoomId ?? selectedRoomId;
    if (preferred && allowed.some((room) => room.id === preferred)) {
      setSelectedRoomId(preferred);
    } else {
      setSelectedRoomId(allowed[0]?.id ?? null);
    }
  };

  useEffect(() => {
    const boot = async () => {
      try {
        await detectRoomStateColumnsSupport();
        const usersData = await fetchUsers();
        setUsers(usersData);

        const stored = localStorage.getItem(SESSION_KEY);
        if (stored) {
          const found = usersData.find((user) => user.username === stored) ?? null;
          setSessionUser(found);
        }
      } catch (error) {
        console.error(error);
        setLoginError('Erro ao conectar no Supabase.');
      } finally {
        setIsBootLoading(false);
      }
    };

    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sessionUser) {
      setRooms([]);
      setSelectedRoomId(null);
      setSelectedRoom(null);
      setRoomPlayers([]);
      setActions([]);
      return;
    }

    void refreshBaseData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUser]);

  useEffect(() => {
    if (!sessionUser || !selectedRoomId) {
      setSelectedRoom(null);
      setRoomPlayers([]);
      setActions([]);
      return;
    }

    void loadRoomData(selectedRoomId);

    const channel = supabase
      .channel(`room-${selectedRoomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_rooms', filter: `id=eq.${selectedRoomId}` }, () => {
        void loadRoomData(selectedRoomId);
        void refreshBaseData(selectedRoomId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${selectedRoomId}` }, () => {
        void loadRoomData(selectedRoomId);
        void refreshBaseData(selectedRoomId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_actions', filter: `room_id=eq.${selectedRoomId}` }, () => {
        void loadRoomData(selectedRoomId);
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomId, sessionUser?.username]);

  useEffect(() => {
    if (!selectedCardUid) return;
    const stillExists = gameState.drawPile.some((entry) => entry.uid === selectedCardUid);
    if (!stillExists) {
      setSelectedCardUid(null);
      setSelectedRule(null);
      setSelectedTargetA('');
      setSelectedTargetB('');
      setSelectedDiscardUid('');
      setSelectedOrder([]);
    }
  }, [gameState.drawPile, selectedCardUid]);

  useEffect(() => {
    if (!selectedRoomId) return;
    setRoomModeDraft(roomMode);
  }, [roomMode, selectedRoomId]);

  useEffect(() => {
    if (!selectedRoomId || actions.length === 0) {
      setLiveAnimationActionId(null);
      if (animationTimerRef.current !== null) {
        window.clearTimeout(animationTimerRef.current);
        animationTimerRef.current = null;
      }
      lastAnimatedActionIdRef.current = null;
      initializedRoomRef.current = null;
      return;
    }

    const latest = actions[0];
    if (initializedRoomRef.current !== selectedRoomId) {
      initializedRoomRef.current = selectedRoomId;
      lastAnimatedActionIdRef.current = latest.id;
      setLiveAnimationActionId(null);
      return;
    }

    if (lastAnimatedActionIdRef.current === latest.id || !latest.card_key) return;
    lastAnimatedActionIdRef.current = latest.id;
    setLiveAnimationActionId(latest.id);

    if (latest.card_key === 'wheel') {
      const match = latest.description.match(/::WHEEL:([+-]?\d+)/i);
      const rolled = match ? Number(match[1]) : 1;
      const idx = Math.max(0, WHEEL_SLOTS.indexOf(rolled));
      const slice = 360 / WHEEL_SLOTS.length;
      const targetAngle = 360 - (idx * slice + slice / 2);
      const turns = (Math.floor(Math.random() * 3) + 4) * 360;
      setWheelSpinDegrees(turns + targetAngle);
    }

    const timeoutMs = latest.card_key === 'wheel' ? 4300 : 2600;
    if (animationTimerRef.current !== null) window.clearTimeout(animationTimerRef.current);
    animationTimerRef.current = window.setTimeout(() => {
      setLiveAnimationActionId((prev) => (prev === latest.id ? null : prev));
      animationTimerRef.current = null;
    }, timeoutMs);
  }, [actions, selectedRoomId]);

  useEffect(() => {
    return () => {
      if (animationTimerRef.current !== null) window.clearTimeout(animationTimerRef.current);
    };
  }, []);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginError('');

    try {
      let source = users;
      if (source.length === 0) {
        source = await fetchUsers();
        setUsers(source);
      }

      const query = normalizeText(loginName);
      const found = source.find((user) => {
        return normalizeText(user.username) === query || normalizeText(user.display_name) === query;
      });

      if (!found || found.password !== loginPassword) {
        setLoginError('Credenciais invalidas.');
        return;
      }

      setSessionUser(found);
      localStorage.setItem(SESSION_KEY, found.username);
      setLoginName('');
      setLoginPassword('');
    } catch (error) {
      console.error(error);
      setLoginError('Falha ao autenticar.');
    }
  };

  const handleLogout = () => {
    setSessionUser(null);
    localStorage.removeItem(SESSION_KEY);
    setSelectedCardUid(null);
    setSelectedRule(null);
    setSelectedTargetA('');
    setSelectedTargetB('');
    setSelectedDiscardUid('');
    setSelectedOrder([]);
  };
  const handleCreateRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sessionUser || sessionUser.role !== 'master') return;
    const name = newRoomName.trim();
    if (!name) return;

    setIsMutating(true);
    try {
      const useLegacyMode = supportsRoomStateColumns === false;
      const insertPayload = useLegacyMode
        ? {
            name,
            created_by: sessionUser.username,
            status: 'waiting' as const,
            turn_order: [] as string[],
            current_turn_index: 0,
          }
        : {
            name,
            created_by: sessionUser.username,
            status: 'waiting' as const,
            game_mode: newRoomMode,
            game_state: {},
            turn_order: [] as string[],
            current_turn_index: 0,
          };

      const { data, error } = await supabase
        .from('game_rooms')
        .insert(insertPayload)
        .select('*')
        .single();

      if (error) throw error;

      if (useLegacyMode) {
        await supabase.from('game_actions').insert({
          room_id: (data as GameRoom).id,
          actor_username: sessionUser.username,
          target_username: null,
          card_key: null,
          description: `Modo da sessao definido para ${newRoomMode === 'short' ? 'curto' : 'longo'}. ::MODE:${newRoomMode}`,
        });
      }

      setNewRoomName('');
      setNewRoomMode('short');
      await refreshBaseData((data as GameRoom).id);
      toast('Sessao criada.');
    } catch (error) {
      console.error(error);
      if (isMissingRoomStateColumnsError(error)) {
        setSupportsRoomStateColumns(false);
        toast('Banco antigo detectado. Tente novamente; modo compatibilidade foi ativado.');
        return;
      }
      toast('Erro ao criar sessao.');
    } finally {
      setIsMutating(false);
    }
  };

  const handleCreateInternalPlayer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sessionUser || sessionUser.role !== 'master') return;

    const username = normalizeText(newUserLogin);
    const displayName = newUserName.trim();
    const password = newUserPassword.trim();

    if (!username || !displayName || !password) {
      toast('Preencha login, nome e senha.');
      return;
    }

    setIsMutating(true);
    try {
      const { error } = await supabase.from('internal_users').insert({
        username,
        display_name: displayName,
        password,
        role: 'player',
        active: true,
      });

      if (error) throw error;

      setNewUserLogin('');
      setNewUserName('');
      setNewUserPassword('1234');
      setUsers(await fetchUsers());
      toast('Jogador interno cadastrado.');
    } catch (error) {
      console.error(error);
      toast('Erro ao cadastrar jogador.');
    } finally {
      setIsMutating(false);
    }
  };

  const handleAddPlayerToRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedRoomId || !playerToAdd) return;

    setIsMutating(true);
    try {
      const { error } = await supabase.from('room_players').insert({
        room_id: selectedRoomId,
        username: playerToAdd,
        chips: 1,
        is_ready: false,
      });
      if (error) throw error;

      setPlayerToAdd('');
      toast('Jogador adicionado na sessao.');
    } catch (error) {
      console.error(error);
      toast('Erro ao adicionar jogador.');
    } finally {
      setIsMutating(false);
    }
  };

  const handleRemovePlayerFromRoom = async (username: string) => {
    if (!selectedRoomId || !sessionUser || sessionUser.role !== 'master') return;
    if (selectedRoom?.status !== 'waiting') {
      toast('Remocao somente quando a sessao estiver aguardando.');
      return;
    }

    setIsMutating(true);
    try {
      const { error } = await supabase
        .from('room_players')
        .delete()
        .eq('room_id', selectedRoomId)
        .eq('username', username);
      if (error) throw error;
      toast('Jogador removido.');
    } catch (error) {
      console.error(error);
      toast('Erro ao remover jogador.');
    } finally {
      setIsMutating(false);
    }
  };

  const handleUpdateRoomMode = async () => {
    if (!selectedRoom || !sessionUser || sessionUser.role !== 'master') return;
    if (selectedRoom.status !== 'waiting') {
      toast('Modo so pode ser alterado com sessao em espera.');
      return;
    }
    setIsMutating(true);
    try {
      const useLegacyMode = supportsRoomStateColumns === false;
      if (!useLegacyMode) {
        const { error } = await supabase
          .from('game_rooms')
          .update({ game_mode: roomModeDraft, game_state: {} })
          .eq('id', selectedRoom.id)
          .eq('status', 'waiting');
        if (error) throw error;
      } else {
        const { error } = await supabase.from('game_actions').insert({
          room_id: selectedRoom.id,
          actor_username: sessionUser.username,
          target_username: null,
          card_key: null,
          description: `Modo da sessao definido para ${roomModeDraft === 'short' ? 'curto' : 'longo'}. ::MODE:${roomModeDraft}`,
        });
        if (error) throw error;
      }
      toast('Modo da sessao atualizado.');
    } catch (error) {
      console.error(error);
      if (isMissingRoomStateColumnsError(error)) {
        setSupportsRoomStateColumns(false);
        toast('Modo compatibilidade ativado. Clique em atualizar modo novamente.');
        return;
      }
      toast('Erro ao atualizar modo.');
    } finally {
      setIsMutating(false);
    }
  };

  const maybeAutoStartGame = async (roomId: string) => {
    const { data: roomData, error: roomError } = await supabase.from('game_rooms').select('*').eq('id', roomId).maybeSingle();
    if (roomError) throw roomError;

    const room = roomData as GameRoom | null;
    if (!room || room.status !== 'waiting') return;

    const { data: playersData, error: playersError } = await supabase.from('room_players').select('*').eq('room_id', roomId);
    if (playersError) throw playersError;

    const players = (playersData ?? []) as RoomPlayer[];
    if (players.length === 0 || players.some((player) => !player.is_ready)) return;

    const useLegacyMode = supportsRoomStateColumns === false;
    let mode = (room.game_mode as GameMode) || roomModeDraft || 'short';
    if (useLegacyMode || !room.game_mode) {
      const { data: modeActions, error: modeActionsError } = await supabase
        .from('game_actions')
        .select('description')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(80);
      if (modeActionsError) throw modeActionsError;
      for (const action of modeActions ?? []) {
        const parsedMode = extractModeToken(action.description as string);
        if (parsedMode) {
          mode = parsedMode;
          break;
        }
      }
    }

    const turnOrder = shuffle(players.map((player) => player.username));
    const now = new Date().toISOString();
    const gameStateSeed = initializeGameState(mode, turnOrder);
    const updatePayload = useLegacyMode
      ? {
          status: 'running' as const,
          turn_order: turnOrder,
          current_turn_index: 0,
          winner_username: null as string | null,
          started_at: now,
          ended_at: null as string | null,
        }
      : {
          status: 'running' as const,
          game_mode: mode,
          game_state: gameStateSeed,
          turn_order: turnOrder,
          current_turn_index: 0,
          winner_username: null as string | null,
          started_at: now,
          ended_at: null as string | null,
        };

    const { data: startedRoom, error: startError } = await supabase
      .from('game_rooms')
      .update(updatePayload)
      .eq('id', roomId)
      .eq('status', 'waiting')
      .select('*')
      .maybeSingle();

    if (startError) throw startError;
    if (!startedRoom) return;

    const first = turnOrder[0] ?? '-';
    const firstName = userMap.get(first)?.display_name ?? first;

    await supabase.from('game_actions').insert({
      room_id: roomId,
      actor_username: 'mestre',
      target_username: null,
      card_key: null,
      description: `Partida iniciada no modo ${mode === 'short' ? 'curto' : 'longo'}. Primeiro turno: ${firstName}.${useLegacyMode ? ` ::MODE:${mode} ::STATE:${encodeStateToken(gameStateSeed)}` : ''}`,
    });
  };

  const handleReadyToggle = async () => {
    if (!sessionUser || !selectedRoomId) return;
    const me = roomPlayerMap.get(sessionUser.username);
    if (!me) return;

    setIsMutating(true);
    try {
      const { error } = await supabase
        .from('room_players')
        .update({ is_ready: !me.is_ready, last_action_at: new Date().toISOString() })
        .eq('room_id', selectedRoomId)
        .eq('username', sessionUser.username);

      if (error) throw error;
      await maybeAutoStartGame(selectedRoomId);
      toast(!me.is_ready ? 'Voce marcou pronto.' : 'Voce removeu o pronto.');
    } catch (error) {
      console.error(error);
      if (isMissingRoomStateColumnsError(error)) {
        setSupportsRoomStateColumns(false);
        toast('Banco antigo detectado. Tente marcar pronto novamente.');
        return;
      }
      toast('Erro ao atualizar pronto.');
    } finally {
      setIsMutating(false);
    }
  };
  const applyCardEffect = async () => {
    if (!sessionUser || !selectedRoom || !selectedCard) return;
    if (selectedRoom.status !== 'running') return;
    if (currentTurnUsername !== sessionUser.username) {
      toast('Aguarde seu turno.');
      return;
    }

    const mutablePlayers = roomPlayers.map((player) => ({ ...player }));
    const playersMap = new Map(mutablePlayers.map((player) => [player.username, player]));
    const actor = playersMap.get(sessionUser.username);
    if (!actor) {
      toast('Voce nao participa desta sessao.');
      return;
    }

    const state = cloneGameState(gameState);
    const actorStatus = ensureStatus(state, actor.username);

    if ((actorStatus.skipTurns ?? 0) > 0) {
      toast('Voce esta impedido neste turno. Use Encerrar rodada.');
      return;
    }

    setIsMutating(true);
    try {
      const details: string[] = [];
      let wheelDelta: number | null = null;
      let forceNextPlayer: string | null = null;
      let grantExtraTurn = false;
      let deckReset = false;

      const displayName = (username: string) => userMap.get(username)?.display_name ?? username;
      const activePlayers = () =>
        mutablePlayers.filter((player) => !ensureStatus(state, player.username).isOut);

      const getActiveUsernames = () => activePlayers().map((player) => player.username);

      const handFor = (username: string) => {
        if (!state.hands[username]) state.hands[username] = [];
        return state.hands[username];
      };

      const discardFirstCardById = (username: string, cardId: string, reason: string) => {
        const hand = handFor(username);
        const idx = hand.findIndex((entry) => entry.cardId === cardId);
        if (idx < 0) return false;
        const [removed] = hand.splice(idx, 1);
        if (!removed) return false;
        discardCard(removed);
        details.push(reason);
        return true;
      };

      const applyPointDelta = (username: string, delta: number, visited = new Set<string>()) => {
        const player = playersMap.get(username);
        if (!player) return 0;
        const before = player.chips;
        const after = Math.max(0, before + delta);
        const applied = after - before;
        player.chips = after;

        if (visited.has(username)) return applied;
        visited.add(username);

        const status = ensureStatus(state, username);
        if (status.loversLink?.pending) {
          const owner = status.loversLink.owner;
          const partner = status.loversLink.partner;
          status.loversLink = { ...status.loversLink, pending: false };
          const partnerStatus = ensureStatus(state, partner);
          if (partnerStatus.loversLink && partnerStatus.loversLink.partner === username) {
            partnerStatus.loversLink = { ...partnerStatus.loversLink, pending: false };
          }
          if (partner !== username) {
            applyPointDelta(partner, applied, visited);
          }
          discardFirstCardById(
            owner,
            'lovers',
            `${displayName(owner)} ativou o segredo dos Amantes e descartou a carta Os Amantes.`
          );
        }

        return applied;
      };

      const discardCard = (instance: DeckCard) => {
        state.discardPile.push(instance);
      };

      const returnCardToDraw = (instance: DeckCard) => {
        const copy: DeckCard = { ...instance, uid: makeUid(instance.cardId) };
        const index = Math.floor(Math.random() * (state.drawPile.length + 1));
        state.drawPile.splice(index, 0, copy);
      };

      const moveHandToDiscard = (username: string) => {
        const hand = handFor(username);
        if (hand.length === 0) return;
        state.discardPile.push(...hand);
        state.hands[username] = [];
      };

      const takeRandomCard = (username: string) => {
        const hand = handFor(username);
        if (hand.length === 0) return null;
        const idx = Math.floor(Math.random() * hand.length);
        const [card] = hand.splice(idx, 1);
        return card ?? null;
      };

      const refillDeckIfNeeded = () => {
        if (state.drawPile.length > 0 || state.discardPile.length === 0) return;
        state.drawPile = shuffle(state.discardPile.map((entry) => ({ ...entry, uid: makeUid(entry.cardId) })));
        state.discardPile = [];
      };

      const markOut = (username: string) => {
        const player = playersMap.get(username);
        if (!player) return;
        moveHandToDiscard(username);
        player.chips = 0;
        const status = ensureStatus(state, username);
        status.isOut = true;
      };

      const pickAutoTargets = (rule: TarotCardRule, actorUsername: string, prefer?: string) => {
        const result: string[] = [];
        const all = getActiveUsernames();
        const nonSelf = all.filter((username) => username !== actorUsername);
        if ((rule.targetCount ?? 0) <= 0) return result;

        if ((rule.targetCount ?? 0) === 1) {
          if (prefer && all.includes(prefer)) result.push(prefer);
          else if (nonSelf.length > 0) result.push(nonSelf[Math.floor(Math.random() * nonSelf.length)]);
          else if (all.length > 0) result.push(all[0]);
          return result;
        }

        const pool = shuffle([...all]);
        while (pool.length > 0 && result.length < 2) {
          const candidate = pool.shift();
          if (!candidate) break;
          if (!result.includes(candidate)) result.push(candidate);
        }
        return result;
      };

      const resolveTargetDefense = (sourceUsername: string, targetUsername: string) => {
        if (sourceUsername === targetUsername) {
          return { blocked: false, finalTarget: targetUsername, note: '' };
        }

        const status = ensureStatus(state, targetUsername);
        if (status.targetImmunityUntilNextTurn) {
          return { blocked: true, finalTarget: targetUsername, note: `${displayName(targetUsername)} estava protegido e anulou o efeito.` };
        }

        if (status.emperorShield?.active) {
          const owner = status.emperorShield.owner;
          status.emperorShield = undefined;
          discardFirstCardById(
            owner,
            'emperor',
            `${displayName(owner)} ativou o Escudo do Imperador e descartou O Imperador.`
          );
          return { blocked: true, finalTarget: targetUsername, note: `Escudo imperial de ${displayName(targetUsername)} bloqueou o alvo.` };
        }

        if (status.emperorReflect?.active) {
          const owner = status.emperorReflect.owner;
          status.emperorReflect = undefined;
          discardFirstCardById(
            owner,
            'emperor',
            `${displayName(owner)} ativou o Reflexo do Imperador e descartou O Imperador.`
          );
          return {
            blocked: false,
            finalTarget: sourceUsername,
            note: `${displayName(targetUsername)} refletiu o efeito para ${displayName(sourceUsername)}.`,
          };
        }

        return { blocked: false, finalTarget: targetUsername, note: '' };
      };

      const applyTargetDelta = (
        sourceUsername: string,
        rawTarget: string,
        delta: number,
        stealForSource = false
      ) => {
        const defense = resolveTargetDefense(sourceUsername, rawTarget);
        if (defense.note) details.push(defense.note);
        if (defense.blocked) return 0;

        const finalTarget = defense.finalTarget;
        const applied = applyPointDelta(finalTarget, delta);

        if (stealForSource && applied < 0) {
          applyPointDelta(sourceUsername, -applied);
        }

        if (finalTarget !== sourceUsername) {
          const targetStatus = ensureStatus(state, finalTarget);
          if (targetStatus.chariotRetaliation?.active) {
            const owner = targetStatus.chariotRetaliation.owner;
            targetStatus.chariotRetaliation = undefined;
            forceNextPlayer = finalTarget;
            discardFirstCardById(
              owner,
              'chariot',
              `${displayName(owner)} ativou a retaliacao da Carruagem e descartou A Carruagem.`
            );
            details.push(`${displayName(finalTarget)} ativou a retaliacao da Carruagem e tomou o proximo turno.`);
          }
        }

        return applied;
      };

      const triggerDeckResetIfNeeded = () => {
        if (state.drawPile.length > 0) return;
        const allPlayers = Object.keys(state.hands);
        state.drawPile = buildDeck(state.mode);
        state.discardPile = [];
        allPlayers.forEach((username) => {
          state.hands[username] = [];
          state.statuses[username] = {};
        });
        state.currentCycle = safeNumber(state.currentCycle, 1) + 1;
        deckReset = true;
        details.push('Todas as cartas foram usadas. O deck foi reembaralhado e as maos foram reiniciadas.');
      };

      const executeRule = (
        sourceUsername: string,
        _card: TarotCard,
        rule: TarotCardRule,
        rawTargets: string[],
        depth = 0
      ) => {
        const effect = rule.effect;
        const sourcePlayer = playersMap.get(sourceUsername);
        if (!sourcePlayer) return;

        const targets = rawTargets.filter((target) => playersMap.has(target));
        const ascByPoints = () => [...activePlayers()].sort((a, b) => a.chips - b.chips);
        const descByPoints = () => [...activePlayers()].sort((a, b) => b.chips - a.chips);
        const ascByHand = () => [...activePlayers()].sort((a, b) => handFor(a.username).length - handFor(b.username).length);
        const descByHand = () => [...activePlayers()].sort((a, b) => handFor(b.username).length - handFor(a.username).length);
        const sourceHand = handFor(sourceUsername);
        const hasEmperorInHand = sourceHand.some((entry) => entry.cardId === 'emperor');
        const hasSunInHand = sourceHand.some((entry) => entry.cardId === 'sun');

        if (_card.group !== 'major' && _card.rank === 'Rei' && hasEmperorInHand) {
          applyPointDelta(sourceUsername, 1);
          details.push('Easter egg: Rei aliado ao Imperador concedeu +1 ponto.');
        }
        if (_card.group === 'pentacles' && hasSunInHand) {
          applyPointDelta(sourceUsername, 1);
          details.push('Easter egg: Ouro sob o Sol concedeu +1 ponto.');
        }

        switch (effect.kind) {
          case 'fool_h1': {
            const active = getActiveUsernames();
            state.drawPile = buildDeck(state.mode);
            state.discardPile = [];
            active.forEach((username) => {
              state.hands[username] = [];
              const player = playersMap.get(username);
              if (player) player.chips = 1;
            });
            const actorPlayer = playersMap.get(sourceUsername);
            if (actorPlayer) actorPlayer.chips = 3;
            active.forEach((username) => drawCards(state, username, INITIAL_HAND_DRAW));
            details.push('O Louco reiniciou as maos e os pontos da mesa.');
            break;
          }
          case 'fool_h2': {
            const target = targets[0];
            if (!target || !playersMap.has(target)) break;
            const targetPlayer = playersMap.get(target);
            if (!targetPlayer) break;
            const actorHand = [...handFor(sourceUsername)];
            const targetHand = [...handFor(target)];
            state.hands[sourceUsername] = targetHand;
            state.hands[target] = actorHand;
            const actorChips = sourcePlayer.chips;
            sourcePlayer.chips = targetPlayer.chips;
            targetPlayer.chips = actorChips;
            getActiveUsernames()
              .filter((username) => username !== sourceUsername && username !== target)
              .forEach((username) => {
                const player = playersMap.get(username);
                if (player) player.chips = 1;
                moveHandToDiscard(username);
                refillDeckIfNeeded();
                drawCards(state, username, INITIAL_HAND_DRAW);
              });
            details.push(`${displayName(sourceUsername)} trocou destino com ${displayName(target)} e desestabilizou os demais.`);
            break;
          }
          case 'magician_h1': {
            applyPointDelta(sourceUsername, -2);
            drawCards(state, sourceUsername, 2);
            details.push('O Mago sacrificou energia e comprou 2 cartas.');
            break;
          }
          case 'magician_h2': {
            if (depth > 2) break;
            const extraCard = takeRandomCard(sourceUsername);
            if (!extraCard) {
              applyPointDelta(sourceUsername, 2);
              details.push('Sem carta para ecoar, o Mago concedeu 2 pontos ao portador.');
              break;
            }
            const extraTarot = cardsById.get(extraCard.cardId);
            if (!extraTarot) {
              discardCard(extraCard);
              break;
            }
            const extraRule = extraTarot.rules[Math.floor(Math.random() * extraTarot.rules.length)] ?? extraTarot.rules[0];
            if (!extraRule) {
              discardCard(extraCard);
              break;
            }
            details.push(`O Mago ecoou ${extraTarot.name}.`);
            const autoTargets = pickAutoTargets(extraRule, sourceUsername, targets[0]);
            executeRule(sourceUsername, extraTarot, extraRule, autoTargets, depth + 1);
            if (extraTarot.id === 'death') returnCardToDraw(extraCard);
            else discardCard(extraCard);
            break;
          }
          case 'priestess_h1': {
            const lowest = ascByPoints()[0];
            if (!lowest) break;
            drawCards(state, lowest.username, 2);
            forceNextPlayer = lowest.username;
            details.push(`${displayName(lowest.username)} recebeu a vez e puxou 2 cartas.`);
            break;
          }
          case 'priestess_h2': {
            const lowest = ascByPoints()[0];
            if (!lowest) break;
            applyPointDelta(lowest.username, 4);
            details.push(`${displayName(lowest.username)} recebeu 4 pontos pela Alta Sacerdotisa.`);
            break;
          }
          case 'empress_h1': {
            applyPointDelta(sourceUsername, 5);
            details.push('A Imperatriz concedeu 5 pontos ao portador.');
            break;
          }
          case 'empress_h2': {
            const active = getActiveUsernames();
            const candidate = selectedOrder.filter((username) => active.includes(username));
            const normalized = candidate.length === active.length ? candidate : active;
            selectedRoom.turn_order = normalized;
            details.push('A Imperatriz reescreveu a ordem da mesa.');
            break;
          }
          case 'emperor_h1': {
            applyPointDelta(sourceUsername, 3);
            ensureStatus(state, sourceUsername).emperorShield = { active: true, owner: sourceUsername };
            details.push('Escudo secreto do Imperador ativado.');
            break;
          }
          case 'emperor_h2': {
            applyPointDelta(sourceUsername, 3);
            ensureStatus(state, sourceUsername).emperorReflect = { active: true, owner: sourceUsername };
            details.push('Reflexo secreto do Imperador ativado.');
            break;
          }
          case 'hierophant_h1': {
            targets.slice(0, 2).forEach((username) => applyPointDelta(username, 2));
            details.push('O Hierofante abencoou dois jogadores com 2 pontos.');
            break;
          }
          case 'hierophant_h2': {
            ascByPoints().slice(0, 2).forEach((player) => applyPointDelta(player.username, 3));
            details.push('O Hierofante fortaleceu os dois com menos pontos.');
            break;
          }
          case 'lovers_h1': {
            const target = targets[0];
            if (!target) break;
            applyPointDelta(sourceUsername, 2);
            applyPointDelta(target, 2);
            ensureStatus(state, sourceUsername).loversLink = { partner: target, type: 'points', pending: true, owner: sourceUsername };
            ensureStatus(state, target).loversLink = { partner: sourceUsername, type: 'points', pending: true, owner: sourceUsername };
            details.push(`${displayName(sourceUsername)} e ${displayName(target)} selaram um elo de pontos.`);
            break;
          }
          case 'lovers_h2': {
            const target = targets[0];
            if (!target) break;
            const sourceStatus = ensureStatus(state, sourceUsername);
            const targetStatus = ensureStatus(state, target);
            sourceStatus.extraDrawNextTurn = safeNumber(sourceStatus.extraDrawNextTurn) + 1;
            targetStatus.extraDrawNextTurn = safeNumber(targetStatus.extraDrawNextTurn) + 1;
            sourceStatus.loversLink = { partner: target, type: 'draw', pending: true, owner: sourceUsername };
            targetStatus.loversLink = { partner: sourceUsername, type: 'draw', pending: true, owner: sourceUsername };
            details.push(`${displayName(sourceUsername)} e ${displayName(target)} receberao compra extra no proximo turno.`);
            break;
          }
          case 'chariot_h1': {
            applyPointDelta(sourceUsername, 3);
            grantExtraTurn = true;
            details.push('A Carruagem garantiu novo turno imediato.');
            break;
          }
          case 'chariot_h2': {
            applyPointDelta(sourceUsername, 3);
            ensureStatus(state, sourceUsername).chariotRetaliation = { active: true, owner: sourceUsername };
            details.push('Retaliacao secreta da Carruagem armada.');
            break;
          }
          case 'strength_h1': {
            getActiveUsernames()
              .filter((username) => username !== sourceUsername)
              .forEach((username) => {
                const steal = Math.min(1, playersMap.get(username)?.chips ?? 0);
                if (steal > 0) {
                  applyPointDelta(username, -steal);
                  applyPointDelta(sourceUsername, steal);
                }
              });
            details.push('A Forca arrancou 1 ponto de cada adversario.');
            break;
          }
          case 'strength_h2': {
            const stolen: DeckCard[] = [];
            getActiveUsernames()
              .filter((username) => username !== sourceUsername)
              .forEach((username) => {
                const cardStolen = takeRandomCard(username);
                if (cardStolen) stolen.push(cardStolen);
              });
            if (stolen.length === 0) {
              details.push('A Forca nao encontrou cartas para tomar.');
              break;
            }
            const playIndex = Math.floor(Math.random() * stolen.length);
            const [chosen] = stolen.splice(playIndex, 1);
            handFor(sourceUsername).push(...stolen);
            if (!chosen) break;
            const chosenCard = cardsById.get(chosen.cardId);
            if (!chosenCard) {
              discardCard(chosen);
              break;
            }
            const chosenRule = chosenCard.rules[Math.floor(Math.random() * chosenCard.rules.length)] ?? chosenCard.rules[0];
            if (!chosenRule) {
              discardCard(chosen);
              break;
            }
            details.push(`${displayName(sourceUsername)} roubou cartas e disparou ${chosenCard.name}.`);
            const autoTargets = pickAutoTargets(chosenRule, sourceUsername, targets[0]);
            executeRule(sourceUsername, chosenCard, chosenRule, autoTargets, depth + 1);
            if (chosenCard.id === 'death') returnCardToDraw(chosen);
            else discardCard(chosen);
            break;
          }
          case 'hermit_h1': {
            const status = ensureStatus(state, sourceUsername);
            status.skipTurns = safeNumber(status.skipTurns) + 1;
            status.onResumePointDelta = safeNumber(status.onResumePointDelta) + 6;
            details.push('O Eremita ficou ausente e retornara com bonus de pontos.');
            break;
          }
          case 'hermit_h2': {
            applyPointDelta(sourceUsername, 3);
            ensureStatus(state, sourceUsername).targetImmunityUntilNextTurn = true;
            details.push('Manto de isolamento do Eremita ativado.');
            break;
          }
          case 'wheel_h1': {
            const roll = WHEEL_SLOTS[Math.floor(Math.random() * WHEEL_SLOTS.length)] ?? 1;
            applyPointDelta(sourceUsername, roll);
            wheelDelta = roll;
            details.push(`A roleta da fortuna girou em ${formatSigned(roll)}.`);
            break;
          }
          case 'wheel_h2': {
            const pool = targets.length >= 2 ? targets.slice(0, 2) : pickAutoTargets({ ...rule, targetCount: 2 }, sourceUsername);
            if (pool.length < 2) break;
            const [a, b] = shuffle(pool);
            applyPointDelta(a, 3);
            applyPointDelta(b, -3);
            details.push(`A sorte favoreceu ${displayName(a)} e puniu ${displayName(b)}.`);
            break;
          }
          case 'justice_h1': {
            const active = activePlayers();
            if (active.length === 0) break;
            const total = active.reduce((acc, player) => acc + player.chips, 0);
            const equal = Math.ceil(total / active.length);
            active.forEach((player) => {
              player.chips = Math.max(0, equal);
            });
            details.push('A Justica redistribuiu os pontos igualmente.');
            break;
          }
          case 'justice_h2': {
            const minPoints = ascByPoints()[0]?.chips ?? 0;
            const targetValue = Math.max(0, minPoints - 1);
            activePlayers().forEach((player) => {
              player.chips = targetValue;
            });
            details.push('A Justica derrubou todos abaixo do menor valor anterior.');
            break;
          }
          case 'hanged_man_h1': {
            const status = ensureStatus(state, sourceUsername);
            status.skipTurns = safeNumber(status.skipTurns) + 1;
            status.onResumePointDelta = safeNumber(status.onResumePointDelta) - 3;
            details.push('O Enforcado impediu o proximo turno do portador com penalidade futura.');
            break;
          }
          case 'hanged_man_h2': {
            applyPointDelta(sourceUsername, -5);
            const target = targets[0];
            if (target) {
              const status = ensureStatus(state, target);
              status.skipTurns = safeNumber(status.skipTurns) + 1;
              details.push(`${displayName(target)} perdera o proximo turno pelo Enforcado.`);
            }
            break;
          }
          case 'death_h1': {
            const current = playersMap.get(sourceUsername)?.chips ?? 0;
            if (current > 0) applyPointDelta(sourceUsername, -current);
            moveHandToDiscard(sourceUsername);
            details.push('A Morte zerou pontos e mao do portador.');
            break;
          }
          case 'death_h2': {
            const target = targets[0];
            if (!target) break;
            markOut(sourceUsername);
            markOut(target);
            details.push(`${displayName(sourceUsername)} e ${displayName(target)} foram removidos da partida.`);
            break;
          }
          case 'temperance_h1': {
            const richest = descByPoints()[0];
            if (!richest) break;
            const gain = Math.floor(richest.chips / 2);
            applyPointDelta(sourceUsername, gain);
            details.push('A Temperanca converteu excesso em equilibrio favoravel.');
            break;
          }
          case 'temperance_h2': {
            const highest = descByPoints().slice(0, 2);
            highest.forEach((player) => {
              const loss = Math.floor(player.chips / 2);
              applyPointDelta(player.username, -loss);
            });
            const currentMin = ascByPoints()[0]?.chips ?? 0;
            activePlayers()
              .filter((player) => player.chips === currentMin)
              .forEach((player) => {
                applyPointDelta(player.username, player.chips);
              });
            details.push('A Temperanca drenou os lideres e elevou os menores.');
            break;
          }
          case 'devil_h1': {
            const target = targets[0];
            if (!target) break;
            applyPointDelta(target, 3);
            const status = ensureStatus(state, target);
            status.pendingPointPenaltyNextTurn = safeNumber(status.pendingPointPenaltyNextTurn) + 6;
            details.push(`${displayName(target)} recebeu pacto do Diabo e pagara o dobro no proximo turno.`);
            break;
          }
          case 'devil_h2': {
            applyPointDelta(sourceUsername, 3);
            const status = ensureStatus(state, sourceUsername);
            status.pendingPointPenaltyNextTurn = safeNumber(status.pendingPointPenaltyNextTurn) + 6;
            details.push('O pacto do Diabo deu bonus imediato e custo dobrado depois.');
            break;
          }
          case 'tower_h1': {
            activePlayers().forEach((player) => applyPointDelta(player.username, -5));
            details.push('A Torre derrubou 5 pontos de toda a mesa.');
            break;
          }
          case 'tower_h2': {
            applyPointDelta(sourceUsername, -5);
            refillDeckIfNeeded();
            drawCards(state, sourceUsername, 1);
            details.push('A Torre cobrou 5 pontos e entregou uma nova carta.');
            break;
          }
          case 'star_h1': {
            const richest = descByPoints().find((player) => player.username !== sourceUsername);
            if (!richest) break;
            const steal = Math.min(3, richest.chips);
            if (steal > 0) {
              applyPointDelta(richest.username, -steal);
              applyPointDelta(sourceUsername, steal);
            }
            details.push('A Estrela drenou pontos do jogador mais forte.');
            break;
          }
          case 'star_h2': {
            const target = targets[0];
            if (!target) break;
            const stolen = takeRandomCard(target);
            if (!stolen) {
              details.push(`${displayName(target)} nao tinha cartas para roubo.`);
              break;
            }
            const stolenCard = cardsById.get(stolen.cardId);
            if (!stolenCard) {
              discardCard(stolen);
              break;
            }
            const stolenRule = stolenCard.rules[Math.floor(Math.random() * stolenCard.rules.length)] ?? stolenCard.rules[0];
            if (!stolenRule) {
              discardCard(stolen);
              break;
            }
            details.push(`${displayName(sourceUsername)} roubou ${stolenCard.name} e ativou seu efeito.`);
            const autoTargets = pickAutoTargets(stolenRule, sourceUsername, target);
            executeRule(sourceUsername, stolenCard, stolenRule, autoTargets, depth + 1);
            if (stolenCard.id === 'death') returnCardToDraw(stolen);
            else discardCard(stolen);
            break;
          }
          case 'moon_h1': {
            const lowHand = ascByHand()[0];
            if (lowHand) applyPointDelta(lowHand.username, 3);
            activePlayers().forEach((player) => {
              const hasSun = handFor(player.username).some((cardInHand) => cardInHand.cardId === 'sun');
              if (hasSun) applyPointDelta(player.username, -3);
            });
            details.push('A Lua premiou quem tinha menos cartas e cobrou de quem guardava o Sol.');
            break;
          }
          case 'moon_h2': {
            const highHand = descByHand()[0];
            if (highHand) applyPointDelta(highHand.username, -3);
            activePlayers().forEach((player) => {
              const hasSun = handFor(player.username).some((cardInHand) => cardInHand.cardId === 'sun');
              if (hasSun) applyPointDelta(player.username, 3);
            });
            details.push('A Lua puniu o excesso de cartas e fortaleceu quem guardava o Sol.');
            break;
          }
          case 'sun_h1': {
            grantExtraTurn = true;
            activePlayers().forEach((player) => {
              const hasMoon = handFor(player.username).some((cardInHand) => cardInHand.cardId === 'moon');
              if (hasMoon) {
                const status = ensureStatus(state, player.username);
                status.skipTurns = safeNumber(status.skipTurns) + 1;
              }
            });
            details.push('O Sol abriu novo turno e eclipsou os portadores da Lua.');
            break;
          }
          case 'sun_h2': {
            applyPointDelta(sourceUsername, 3);
            activePlayers().forEach((player) => {
              if (player.username === sourceUsername) return;
              const hasMoon = handFor(player.username).some((cardInHand) => cardInHand.cardId === 'moon');
              if (!hasMoon) return;
              const steal = Math.min(3, player.chips);
              if (steal > 0) {
                applyPointDelta(player.username, -steal);
                applyPointDelta(sourceUsername, steal);
              }
            });
            details.push('O Sol absorveu poder dos guardioes da Lua.');
            break;
          }
          case 'judgement_h1': {
            const highest = descByPoints()[0];
            const lowest = ascByPoints()[0];
            if (!highest || !lowest) break;
            const transfer = Math.floor(highest.chips / 2);
            applyPointDelta(highest.username, -transfer);
            applyPointDelta(lowest.username, transfer);
            details.push('O Julgamento transferiu metade do lider para o menor.');
            break;
          }
          case 'judgement_h2': {
            const target = targets[0];
            const lowest = ascByPoints()[0];
            if (!target || !lowest) break;
            const targetPlayer = playersMap.get(target);
            if (!targetPlayer) break;
            const transfer = Math.floor(targetPlayer.chips / 2);
            applyPointDelta(target, -transfer);
            applyPointDelta(lowest.username, transfer);
            details.push(`${displayName(target)} concedeu metade ao menor pontuador por sentenca.`);
            break;
          }
          case 'world_h1': {
            applyPointDelta(sourceUsername, 7);
            details.push('O Mundo concedeu 7 pontos.');
            break;
          }
          case 'world_h2': {
            refillDeckIfNeeded();
            drawCards(state, sourceUsername, 3);
            details.push('O Mundo abriu 3 novas cartas.');
            break;
          }
          case 'minor_swords_cut_deck': {
            const half = Math.floor(state.drawPile.length / 2);
            const cut = state.drawPile.splice(0, half);
            state.discardPile.push(...cut);
            details.push('Espadas cortaram metade do baralho de compra.');
            break;
          }
          case 'minor_swords_target_loss': {
            const target = targets[0];
            if (!target) break;
            const amount = safeNumber(effect.amount, 1);
            applyTargetDelta(sourceUsername, target, -amount, false);
            details.push(`${displayName(target)} perdeu ate ${amount} pontos por Espadas.`);
            break;
          }
          case 'minor_cups_gain': {
            const amount = safeNumber(effect.amount, 1);
            applyPointDelta(sourceUsername, amount);
            details.push(`Copas restauraram ${amount} pontos ao portador.`);
            break;
          }
          case 'minor_pentacles_trade': {
            const target = targets[0];
            if (!target) break;
            const amount = safeNumber(effect.amount, 1);
            applyTargetDelta(sourceUsername, target, -amount, true);
            details.push(`${displayName(sourceUsername)} roubou pontos de ${displayName(target)} com Ouros.`);
            break;
          }
          case 'minor_wands_draw_or_turn': {
            const amount = safeNumber(effect.amount, 1);
            refillDeckIfNeeded();
            drawCards(state, sourceUsername, Math.max(1, amount - 1));
            grantExtraTurn = true;
            details.push('Paus aceleraram o ritmo com compra extra e novo turno.');
            break;
          }
          default:
            details.push(`Efeito ${String(effect.kind)} nao mapeado.`);
            break;
        }
      };

      if (actorStatus.targetImmunityUntilNextTurn) {
        actorStatus.targetImmunityUntilNextTurn = false;
      }

      if (safeNumber(actorStatus.pendingPointPenaltyNextTurn) > 0) {
        const penalty = safeNumber(actorStatus.pendingPointPenaltyNextTurn);
        applyPointDelta(actor.username, -penalty);
        actorStatus.pendingPointPenaltyNextTurn = 0;
        details.push(`${displayName(actor.username)} pagou penalidade pendente de ${penalty} pontos.`);
      }

      if (safeNumber(actorStatus.extraDrawNextTurn) > 0) {
        const bonusDraw = safeNumber(actorStatus.extraDrawNextTurn);
        refillDeckIfNeeded();
        drawCards(state, actor.username, bonusDraw);
        actorStatus.extraDrawNextTurn = 0;
        details.push(`${displayName(actor.username)} recebeu compra extra de ${bonusDraw} carta(s).`);
      }

      const drawIndex = state.drawPile.findIndex((item) => item.uid === selectedCard.instance.uid);
      if (drawIndex < 0) {
        throw new Error('Carta selecionada nao esta mais disponivel no deck.');
      }
      const [drawnInstance] = state.drawPile.splice(drawIndex, 1);
      if (!drawnInstance) throw new Error('Falha ao registrar carta puxada.');
      handFor(actor.username).push(drawnInstance);

      const playRule = selectedRule ?? selectedCard.card.rules[Math.floor(Math.random() * selectedCard.card.rules.length)] ?? selectedCard.card.rules[0];
      if (!playRule) throw new Error('Carta sem regra valida.');
      const chosenTargets: string[] = [];
      if ((playRule.targetCount ?? 0) >= 1) {
        if (selectedTargetA) chosenTargets.push(selectedTargetA);
      }
      if ((playRule.targetCount ?? 0) >= 2) {
        if (selectedTargetB) chosenTargets.push(selectedTargetB);
      }
      const autoTargets = pickAutoTargets(playRule, actor.username, selectedTargetA || undefined);
      while (chosenTargets.length < (playRule.targetCount ?? 0) && autoTargets.length > 0) {
        const next = autoTargets.shift();
        if (!next) break;
        if (!chosenTargets.includes(next)) chosenTargets.push(next);
      }

      executeRule(actor.username, selectedCard.card, playRule, chosenTargets, 0);

      if (selectedCard.card.id === 'death') {
        const actorCards = handFor(actor.username);
        const deathIndex = actorCards.findIndex((item) => item.uid === drawnInstance.uid);
        if (deathIndex >= 0) {
          const [deathCard] = actorCards.splice(deathIndex, 1);
          if (deathCard) returnCardToDraw(deathCard);
        } else {
          returnCardToDraw(drawnInstance);
        }
      }

      const actorCardsAfterEffects = handFor(actor.username);
      if (actorCardsAfterEffects.length >= 5) {
        let discardIndex = -1;
        if (selectedDiscardUid) {
          discardIndex = actorCardsAfterEffects.findIndex((item) => item.uid === selectedDiscardUid);
        }
        if (discardIndex < 0) {
          discardIndex = Math.max(0, actorCardsAfterEffects.length - 1);
          details.push('Sem descarte escolhido, a carta mais recente foi descartada automaticamente.');
        }
        const [discarded] = actorCardsAfterEffects.splice(discardIndex, 1);
        if (discarded) {
          discardCard(discarded);
          const discardedCardName = cardsById.get(discarded.cardId)?.name ?? discarded.cardId;
          details.push(`${displayName(actor.username)} descartou ${discardedCardName} ao atingir 5 cartas na mao.`);
        }
      }

      const orderBase = (selectedRoom.turn_order ?? []).filter((username) => {
        const player = playersMap.get(username);
        return Boolean(player) && !ensureStatus(state, username).isOut;
      });
      const order = orderBase.length > 0 ? orderBase : getActiveUsernames();

      const highestWinner = [...activePlayers()].sort((a, b) => b.chips - a.chips).find((player) => player.chips >= WIN_TARGET) ?? null;
      const alive = activePlayers();
      const winner = highestWinner ?? (alive.length === 1 ? alive[0] : null);

      let nextTurnUser = actor.username;
      const skipNotes: string[] = [];

      if (!winner) {
        if (grantExtraTurn && order.includes(actor.username) && !ensureStatus(state, actor.username).isOut) {
          nextTurnUser = actor.username;
        } else if (forceNextPlayer && order.includes(forceNextPlayer) && !ensureStatus(state, forceNextPlayer).isOut) {
          nextTurnUser = forceNextPlayer;
        } else if (order.length > 0) {
          const startAt = order.indexOf(actor.username) >= 0 ? order.indexOf(actor.username) : 0;
          for (let i = 1; i <= order.length; i += 1) {
            const candidate = order[(startAt + i) % order.length];
            const status = ensureStatus(state, candidate);
            if (status.isOut) continue;
            if ((status.skipTurns ?? 0) > 0) {
              status.skipTurns = safeNumber(status.skipTurns) - 1;
              skipNotes.push(`${displayName(candidate)} perdeu o turno.`);
              if ((status.skipTurns ?? 0) === 0 && safeNumber(status.onResumePointDelta) !== 0) {
                status.pendingPointPenaltyNextTurn = safeNumber(status.pendingPointPenaltyNextTurn) + safeNumber(status.onResumePointDelta);
                status.onResumePointDelta = 0;
              }
              continue;
            }
            nextTurnUser = candidate;
            break;
          }
        }
      }

      if (!winner) {
        triggerDeckResetIfNeeded();
      }

      const now = new Date().toISOString();
      const useLegacyMode = supportsRoomStateColumns === false;
      const roomUpdate = winner
        ? {
            status: 'finished' as const,
            winner_username: winner.username,
            ended_at: now,
            turn_order: order,
            ...(useLegacyMode ? {} : { game_state: state }),
          }
        : {
            current_turn_index: Math.max(0, order.indexOf(nextTurnUser)),
            turn_order: order,
            ...(useLegacyMode ? {} : { game_state: state }),
          };

      const { error: roomError } = await supabase
        .from('game_rooms')
        .update(roomUpdate)
        .eq('id', selectedRoom.id)
        .eq('status', 'running');
      if (roomError) throw roomError;

      const updates = mutablePlayers.map((player) =>
        supabase
          .from('room_players')
          .update({ chips: player.chips, last_action_at: now })
          .eq('room_id', selectedRoom.id)
          .eq('username', player.username)
      );
      await Promise.all(updates);

      const actorName = displayName(actor.username);
      const targetLog = chosenTargets.length > 0
        ? ` Alvo(s): ${chosenTargets.map((username) => displayName(username)).join(', ')}.`
        : '';
      const detailLog = details.length > 0 ? ` ${details.join(' ')}` : '';
      const skipLog = skipNotes.length > 0 ? ` ${skipNotes.join(' ')}` : '';
      const wheelMeta = wheelDelta != null ? ` ::WHEEL:${formatSigned(wheelDelta)}` : '';
      const deckMeta = deckReset ? ' ::DECK_RESET' : '';

      const legacyMeta = useLegacyMode ? ` ::MODE:${roomMode} ::STATE:${encodeStateToken(state)}` : '';
      const description = winner
        ? `${actorName} jogou ${selectedCard.card.name}.${targetLog}${detailLog}${skipLog} ${displayName(winner.username)} venceu a partida!${wheelMeta}${deckMeta}${legacyMeta}`
        : `${actorName} jogou ${selectedCard.card.name}.${targetLog}${detailLog}${skipLog} Proximo turno: ${displayName(nextTurnUser)}.${wheelMeta}${deckMeta}${legacyMeta}`;

      const { error: actionError } = await supabase.from('game_actions').insert({
        room_id: selectedRoom.id,
        actor_username: actor.username,
        target_username: chosenTargets[0] ?? null,
        card_key: selectedCard.card.id,
        description,
      });
      if (actionError) throw actionError;

      setSelectedCardUid(null);
      setSelectedRule(null);
      setSelectedTargetA('');
      setSelectedTargetB('');
      setSelectedDiscardUid('');
      setSelectedOrder([]);
      toast(winner ? 'Temos um vencedor!' : 'Jogada aplicada.');
    } catch (error) {
      console.error(error);
      if (isMissingRoomStateColumnsError(error)) {
        setSupportsRoomStateColumns(false);
        toast('Banco antigo detectado. Aplique a carta novamente.');
        return;
      }
      toast('Erro ao aplicar carta.');
    } finally {
      setIsMutating(false);
    }
  };

  const skipTurn = async () => {
    if (!sessionUser || !selectedRoom || selectedRoom.status !== 'running') return;
    if (currentTurnUsername !== sessionUser.username) {
      toast('Apenas o jogador da vez pode encerrar a rodada.');
      return;
    }

    const order = selectedRoom.turn_order ?? [];
    if (order.length === 0) return;

    const state = cloneGameState(gameState);
    const actorStatus = ensureStatus(state, sessionUser.username);

    if (safeNumber(actorStatus.pendingPointPenaltyNextTurn) > 0) {
      const current = roomPlayerMap.get(sessionUser.username);
      if (current) {
        current.chips = Math.max(0, current.chips - safeNumber(actorStatus.pendingPointPenaltyNextTurn));
      }
      actorStatus.pendingPointPenaltyNextTurn = 0;
    }

    if (actorStatus.targetImmunityUntilNextTurn) {
      actorStatus.targetImmunityUntilNextTurn = false;
    }

    const nextIndex = (selectedRoom.current_turn_index + 1) % order.length;

    setIsMutating(true);
    try {
      const useLegacyMode = supportsRoomStateColumns === false;
      const { error } = await supabase
        .from('game_rooms')
        .update({ current_turn_index: nextIndex, ...(useLegacyMode ? {} : { game_state: state }) })
        .eq('id', selectedRoom.id)
        .eq('status', 'running');
      if (error) throw error;

      const actorName = userMap.get(sessionUser.username)?.display_name ?? sessionUser.username;
      const nextName = userMap.get(order[nextIndex] ?? '')?.display_name ?? order[nextIndex] ?? '-';
      await supabase.from('game_actions').insert({
        room_id: selectedRoom.id,
        actor_username: sessionUser.username,
        target_username: null,
        card_key: null,
        description: `${actorName} encerrou a rodada sem carta. Proximo turno: ${nextName}.${useLegacyMode ? ` ::MODE:${roomMode} ::STATE:${encodeStateToken(state)}` : ''}`,
      });
      toast('Rodada encerrada.');
    } catch (error) {
      console.error(error);
      if (isMissingRoomStateColumnsError(error)) {
        setSupportsRoomStateColumns(false);
        toast('Banco antigo detectado. Tente encerrar rodada novamente.');
        return;
      }
      toast('Erro ao avancar turno.');
    } finally {
      setIsMutating(false);
    }
  };

  const resetMatch = async () => {
    if (!selectedRoom) return;
    setIsMutating(true);
    try {
      const now = new Date().toISOString();
      const { error: playersError } = await supabase
        .from('room_players')
        .update({ chips: 1, is_ready: false, last_action_at: now })
        .eq('room_id', selectedRoom.id);
      if (playersError) throw playersError;

      const { error: roomError } = await supabase
        .from('game_rooms')
        .update({
          status: 'waiting',
          ...(supportsRoomStateColumns === false ? {} : { game_state: {} }),
          turn_order: [],
          current_turn_index: 0,
          winner_username: null,
          started_at: null,
          ended_at: null,
        })
        .eq('id', selectedRoom.id);
      if (roomError) throw roomError;

      await supabase.from('game_actions').insert({
        room_id: selectedRoom.id,
        actor_username: sessionUser?.username ?? 'mestre',
        target_username: null,
        card_key: null,
        description: `Nova partida preparada. Aguardando todos marcarem pronto. ::STATE_RESET${supportsRoomStateColumns === false ? ` ::MODE:${roomModeDraft}` : ''}`,
      });

      setSelectedCardUid(null);
      setSelectedRule(null);
      setSelectedTargetA('');
      setSelectedTargetB('');
      setSelectedDiscardUid('');
      setSelectedOrder([]);
      setRevealedHands({});
      toast('Nova partida pronta.');
    } catch (error) {
      console.error(error);
      if (isMissingRoomStateColumnsError(error)) {
        setSupportsRoomStateColumns(false);
        toast('Banco antigo detectado. Tente resetar novamente.');
        return;
      }
      toast('Erro ao preparar nova partida.');
    } finally {
      setIsMutating(false);
    }
  };

  if (isBootLoading) {
    return (
      <div className="screen-center">
        <div className="loading-orb" />
        <p>Conectando aos arcanos...</p>
      </div>
    );
  }

  if (!sessionUser) {
    return (
      <div className="auth-wrapper">
        <div className="auth-card">
          <p className="eyebrow">A Trilha do Tarot</p>
          <h1>Entrada da Sessao</h1>
          <form onSubmit={handleLogin} className="auth-form">
            <input value={loginName} onChange={(e) => setLoginName(e.target.value)} placeholder="Login ou nome" />
            <input value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} type="password" placeholder="Senha" />
            <button type="submit">Entrar</button>
          </form>
          {loginError && <p className="error-text">{loginError}</p>}
          {isUsingSupabaseFallback && (
            <p className="muted">Aviso: variaveis da Vercel ausentes. App usando fallback de conexao Supabase.</p>
          )}
        </div>
      </div>
    );
  }

  const meInRoom = sessionUser ? roomPlayerMap.get(sessionUser.username) : undefined;
  const playersSorted = [...roomPlayers].sort((a, b) => b.chips - a.chips);
  const availablePlayers = users.filter((user) => user.role === 'player' && !roomPlayerMap.has(user.username));
  const canShowCards = selectedRoom?.status === 'running' && isCurrentUserTurn && isPlayerInRoom;
  const modalTargetCandidates = roomPlayers
    .filter((player) => player.username !== sessionUser.username)
    .map((player) => player.username);
  const discardChoiceCandidates = selectedCard ? [...myHandInstances, selectedCard.instance] : myHandInstances;
  const needsDiscardChoice = Boolean(selectedCard && discardChoiceCandidates.length >= 5);

  const discardCards = gameState.discardPile
    .slice(-12)
    .reverse()
    .map((entry) => cardsById.get(entry.cardId)?.name ?? entry.cardId);

  return (
    <div className="app-bg">
      <div className="nebula nebula-left" />
      <div className="nebula nebula-right" />

      <main className="app-shell">
        <header className="topbar panel">
          <div>
            <p className="eyebrow">Noite mistica em tempo real</p>
            <h1>A Trilha do Tarot</h1>
            <p className="subtitle">Logado como {sessionUser.display_name} ({sessionUser.role === 'master' ? 'mestre' : 'jogador'})</p>
            {supportsRoomStateColumns === false && (
              <p className="muted">Modo de compatibilidade ativo: execute `supabase/schema.sql` no banco para usar armazenamento nativo de modo/estado.</p>
            )}
          </div>
          <button className="ghost-btn" onClick={handleLogout}>Sair</button>
        </header>

        <section className="panel room-panel">
          <div>
            <h2>Sessoes de jogo</h2>
            <p className="muted">Escolha uma sessao para jogar do celular.</p>
          </div>
          <div className="room-actions">
            <select value={selectedRoomId ?? ''} onChange={(e) => setSelectedRoomId(e.target.value || null)} disabled={isMutating || visibleRooms.length === 0}>
              {visibleRooms.length === 0 && <option value="">Sem sessoes disponiveis</option>}
              {visibleRooms.map((room) => (
                <option key={room.id} value={room.id}>{room.name} - {room.status}</option>
              ))}
            </select>
            <button className="ghost-btn" onClick={() => setSelectedRoomId(null)} disabled={!selectedRoomId}>Voltar ao menu</button>
          </div>
        </section>

        {sessionUser.role === 'master' && (
          <section className="master-grid">
            <article className="panel">
              <h2>Aba Mestre - Nova sessao</h2>
              <form onSubmit={handleCreateRoom} className="stack-form">
                <input value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} placeholder="Nome da sessao" />
                <select value={newRoomMode} onChange={(e) => setNewRoomMode(e.target.value as GameMode)}>
                  <option value="short">Modo curto (arcanos maiores)</option>
                  <option value="long">Modo longo (baralho completo)</option>
                </select>
                <button type="submit" disabled={isMutating}>Criar</button>
              </form>
            </article>

            <article className="panel">
              <h2>Aba Mestre - Cadastro interno de jogador</h2>
              <form onSubmit={handleCreateInternalPlayer} className="stack-form">
                <input value={newUserLogin} onChange={(e) => setNewUserLogin(e.target.value)} placeholder="Login interno" />
                <input value={newUserName} onChange={(e) => setNewUserName(e.target.value)} placeholder="Nome exibido" />
                <input value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} placeholder="Senha" />
                <button type="submit" disabled={isMutating}>Cadastrar</button>
              </form>
            </article>
          </section>
        )}

        {!selectedRoomId || !selectedRoom ? (
          <section className="panel">
            <h2>Menu</h2>
            <p className="muted">Selecione uma sessao para entrar.</p>
          </section>
        ) : (
          <>
            <section className="status-grid">
              <article className="panel">
                <h2>{selectedRoom.name}</h2>
                <p className="muted">Status: <strong>{selectedRoom.status}</strong></p>
                <p className="muted">Modo: <strong>{roomMode === 'short' ? 'Curto (Arcanos Maiores)' : 'Longo (Tarot completo)'}</strong></p>
                <p className="muted">Jogador da vez: <strong>{currentTurnUsername ? userMap.get(currentTurnUsername)?.display_name ?? currentTurnUsername : '-'}</strong></p>
                <p className="muted">Proximo jogador: <strong>{nextTurnUsername ? userMap.get(nextTurnUsername)?.display_name ?? nextTurnUsername : '-'}</strong></p>
                <p className="muted">Baralho: {gameState.drawPile.length} compra / {gameState.discardPile.length} descarte / ciclo {gameState.currentCycle}</p>
                {selectedRoom.status === 'waiting' && (
                  <p className="muted">Prontos: {roomPlayers.filter((p) => p.is_ready).length}/{roomPlayers.length} {allReady ? '- iniciando...' : ''}</p>
                )}
                {selectedRoom.status === 'finished' && winnerName && <p className="winner-banner">Vencedor: {winnerName}</p>}

                {sessionUser.role === 'master' && selectedRoom.status === 'waiting' && (
                  <div className="stack-form">
                    <select value={roomModeDraft} onChange={(e) => setRoomModeDraft(e.target.value as GameMode)}>
                      <option value="short">Modo curto (arcanos maiores)</option>
                      <option value="long">Modo longo (baralho completo)</option>
                    </select>
                    <button type="button" className="ghost-btn" onClick={handleUpdateRoomMode} disabled={isMutating}>Atualizar modo da sessao</button>
                  </div>
                )}

                {selectedRoom.status === 'finished' && (
                  <div className="button-row">
                    <button onClick={resetMatch} disabled={isMutating}>Iniciar nova partida</button>
                    <button className="ghost-btn" onClick={() => setSelectedRoomId(null)}>Voltar ao menu</button>
                  </div>
                )}
              </article>

              <article className="panel">
                <h2>Placar e maos</h2>
                <div className="scoreboard">
                  {playersSorted.map((player) => {
                    const display = userMap.get(player.username)?.display_name ?? player.username;
                    const isWinner = player.chips >= WIN_TARGET;
                    const hand = gameState.hands[player.username] ?? [];
                    const open = Boolean(revealedHands[player.username]);

                    return (
                      <div key={player.id} className={`score-row ${isWinner ? 'winner' : ''}`}>
                        <div>
                          <strong>{display}</strong>
                          <p>
                            {player.is_ready ? 'Pronto' : 'Aguardando'}
                            {currentTurnUsername === player.username ? ' - turno atual' : ''}
                            {` - cartas: ${hand.length}`}
                          </p>
                          <button
                            type="button"
                            className="tiny-btn ghost-btn"
                            onClick={() => setRevealedHands((prev) => ({ ...prev, [player.username]: !prev[player.username] }))}
                          >
                            {open ? 'Ocultar mao' : 'Revelar mao'}
                          </button>
                          {open && (
                            <div className="hand-reveal-list">
                              {hand.length === 0 && <small className="muted">Sem cartas na mao.</small>}
                              {hand.map((entry) => {
                                const card = cardsById.get(entry.cardId);
                                return <small key={entry.uid}>{card?.name ?? entry.cardId}</small>;
                              })}
                            </div>
                          )}
                        </div>
                        <span>{player.chips}</span>
                        {sessionUser.role === 'master' && selectedRoom.status === 'waiting' && (
                          <button className="tiny-btn" onClick={() => handleRemovePlayerFromRoom(player.username)} disabled={isMutating}>remover</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </article>
            </section>

            <section className="panel">
              <h2>Acoes da sessao</h2>
              <div className="button-row">
                {isPlayerInRoom && selectedRoom.status === 'waiting' && (
                  <button onClick={handleReadyToggle} disabled={isMutating}>{meInRoom?.is_ready ? 'Cancelar pronto' : 'Estou pronto'}</button>
                )}
                {isCurrentUserTurn && selectedRoom.status === 'running' && (
                  <button onClick={skipTurn} disabled={isMutating}>Encerrar rodada</button>
                )}
                {sessionUser.role === 'master' && (
                  <button className="ghost-btn" onClick={resetMatch} disabled={isMutating}>Resetar partida</button>
                )}
              </div>

              {sessionUser.role === 'master' && selectedRoom.status === 'waiting' && (
                <form onSubmit={handleAddPlayerToRoom} className="form-inline add-player-form">
                  <select value={playerToAdd} onChange={(e) => setPlayerToAdd(e.target.value)}>
                    <option value="">Adicionar jogador na sessao</option>
                    {availablePlayers.map((user) => (
                      <option key={user.username} value={user.username}>{user.display_name}</option>
                    ))}
                  </select>
                  <button type="submit" disabled={!playerToAdd || isMutating}>Adicionar</button>
                </form>
              )}

              <h3>Descarte</h3>
              <p className="muted">Ultimas cartas no descarte: {discardCards.length > 0 ? discardCards.join(' | ') : 'nenhuma'}</p>

              <div className="history-list">
                {actions.length === 0 && <p className="muted">Sem eventos ainda.</p>}
                {actions.map((action) => (
                  <div key={action.id} className="history-item">
                    <span>{formatTime(action.created_at)}</span>
                    <p>{stripActionMeta(action.description)}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel cards-section">
              <div className="cards-title-row">
                <h2>Deck do Tarot</h2>
                <p className="muted">{canShowCards ? 'Seu turno: selecione a carta que voce puxou no baralho real.' : 'Somente o jogador da vez pode registrar carta.'}</p>
              </div>

              {(roomMode === 'long' || handTab !== 'all') && (
                <div className="tab-row">
                  {HAND_TABS.filter((tab) => roomMode === 'long' || tab.id === 'all' || tab.id === 'major').map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      className={`tab-btn ${handTab === tab.id ? 'active' : ''}`}
                      onClick={() => setHandTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}

              <p className="muted">Cartas disponiveis para puxar: {gameState.drawPile.length} | Cartas na sua mao: {myHandInstances.length}</p>

              <div className="cards-grid">
                {availableDeckCards.length === 0 && (
                  <p className="muted">Nenhuma carta disponivel nesta aba do deck.</p>
                )}
                {availableDeckCards.map(({ instance, card }) => (
                  <button
                    key={instance.uid}
                    className={`tarot-card ${canShowCards ? '' : 'locked'}`}
                    disabled={!canShowCards}
                    onClick={() => {
                      setSelectedCardUid(instance.uid);
                      setSelectedRule(card.rules[Math.floor(Math.random() * card.rules.length)] ?? card.rules[0] ?? null);
                      setSelectedTargetA('');
                      setSelectedTargetB('');
                      setSelectedDiscardUid('');
                      setSelectedOrder([]);
                    }}
                    style={{ background: `linear-gradient(160deg, ${card.palette[0]}dd, ${card.palette[1]}dd)` }}
                  >
                    <p>{card.arcana}</p>
                    <span>{card.symbol}</span>
                    <h3>{card.name}</h3>
                    <small>Registrar carta puxada</small>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        {selectedCard && selectedRule && (
          <div className="modal-backdrop" onClick={() => { setSelectedCardUid(null); setSelectedDiscardUid(''); }}>
            <div className="card-modal" onClick={(event) => event.stopPropagation()}>
              <button className="close-btn" onClick={() => { setSelectedCardUid(null); setSelectedDiscardUid(''); }}>x</button>
              <div className="modal-illustration" style={{ background: `linear-gradient(160deg, ${selectedCard.card.palette[0]}dd, ${selectedCard.card.palette[1]}dd)` }}>{selectedCard.card.symbol}</div>
              <div className="modal-content">
                <p className="eyebrow">{selectedCard.card.arcana}</p>
                <h3>{selectedCard.card.name}</h3>
                <p className="effect-highlight"><strong>Efeito:</strong> {selectedRule.effectText}</p>
                <p className="meaning-italic">({selectedRule.flavorText})</p>

                {(selectedRule.targetCount ?? 0) >= 1 && (
                  <select value={selectedTargetA} onChange={(event) => setSelectedTargetA(event.target.value)}>
                    <option value="">Selecione alvo 1</option>
                    {modalTargetCandidates.map((candidate) => (
                      <option key={candidate} value={candidate}>{userMap.get(candidate)?.display_name ?? candidate}</option>
                    ))}
                  </select>
                )}

                {(selectedRule.targetCount ?? 0) >= 2 && (
                  <select value={selectedTargetB} onChange={(event) => setSelectedTargetB(event.target.value)}>
                    <option value="">Selecione alvo 2</option>
                    {[...modalTargetCandidates, sessionUser.username]
                      .filter((candidate) => candidate !== selectedTargetA)
                      .map((candidate) => (
                        <option key={candidate} value={candidate}>{userMap.get(candidate)?.display_name ?? candidate}</option>
                      ))}
                  </select>
                )}

                {needsDiscardChoice && (
                  <div className="stack-form">
                    <p className="muted">Ao atingir 5 cartas na mao, escolha 1 descarte:</p>
                    <select value={selectedDiscardUid} onChange={(event) => setSelectedDiscardUid(event.target.value)}>
                      <option value="">Selecione a carta para descarte</option>
                      {discardChoiceCandidates.map((entry) => {
                        const discardCard = cardsById.get(entry.cardId);
                        return (
                          <option key={`discard-${entry.uid}`} value={entry.uid}>
                            {discardCard?.name ?? entry.cardId}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}

                {selectedRule.requiresOrderSelection && (
                  <div className="stack-form">
                    <p className="muted">Defina a nova ordem da mesa (Imperatriz):</p>
                    <div className="button-row">
                      <button type="button" className="ghost-btn" onClick={() => setSelectedOrder(shuffle(roomPlayers.map((player) => player.username)))}>Ordem aleatoria</button>
                      <button type="button" className="ghost-btn" onClick={() => setSelectedOrder(roomPlayers.map((player) => player.username))}>Ordem atual</button>
                    </div>
                    {selectedOrder.length > 0 && (
                      <p className="muted">Ordem escolhida: {selectedOrder.map((username) => userMap.get(username)?.display_name ?? username).join(' -> ')}</p>
                    )}
                  </div>
                )}

                <button onClick={applyCardEffect} disabled={isMutating || (needsDiscardChoice && !selectedDiscardUid)}>Aplicar efeito</button>
              </div>
            </div>
          </div>
        )}

        {liveAnimationAction && liveAnimationCard && (
          <div className="live-animation-overlay">
            <div className={`live-animation-card ${liveAnimationCard.id === 'wheel' ? 'wheel' : ''}`}>
              <p className="eyebrow">Carta revelada para todos</p>
              <h3>{liveAnimationActorName} jogou {liveAnimationCard.name}</h3>

              {liveAnimationCard.id === 'wheel' ? (
                <>
                  <div className="wheel-stage">
                    <div className="wheel-pointer">v</div>
                    <div className="wheel-disc" style={{ transform: `rotate(${wheelSpinDegrees}deg)` }}>
                      {WHEEL_SLOTS.map((slot, index) => (
                        <span
                          key={`wheel-slot-${slot}`}
                          className="wheel-slot"
                          style={{ transform: `rotate(${index * (360 / WHEEL_SLOTS.length)}deg) translateY(-84px) rotate(${-index * (360 / WHEEL_SLOTS.length)}deg)` }}
                        >
                          {formatSigned(slot)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="wheel-result">Resultado: {wheelResult != null ? formatSigned(wheelResult) : '-'}</p>
                </>
              ) : (
                <>
                  <div className="live-card-glyph">{liveAnimationCard.symbol}</div>
                  <p className="muted">{stripActionMeta(liveAnimationAction.description)}</p>
                </>
              )}
            </div>
          </div>
        )}

        {showVictoryCeremony && (
          <div className="victory-overlay">
            <div className="victory-card">
              <p className="victory-text">VOCE FOI SAGRADO VITORIOSO PELO REI FAMINTO</p>
              <p className="winner-line">Vencedor da partida: {winnerName}</p>
              <img className="victory-image" src="/rei-faminto.svg" alt="Rei Faminto" />
              <div className="button-row">
                <button onClick={resetMatch} disabled={isMutating}>Nova partida</button>
                <button className="ghost-btn" onClick={() => setSelectedRoomId(null)}>Voltar para selecao</button>
              </div>
            </div>
          </div>
        )}

        {uiMessage && <div className="toast">{uiMessage}</div>}
      </main>
    </div>
  );
}

export default App;
