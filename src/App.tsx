import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameAction, GameRoom, InternalUser, RoomPlayer, TarotCard } from './types';
import { supabase } from './supabase';
import { TAROT_CARDS } from './data/tarotCards';

const WIN_TARGET = 10;
const SESSION_KEY = 'tarot-session-user-v1';

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

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatSigned(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

function stripActionMeta(description: string): string {
  return description.replace(/\s*::WHEEL:[+-]?\d+/gi, '').trim();
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
  const [newUserLogin, setNewUserLogin] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('1234');
  const [playerToAdd, setPlayerToAdd] = useState('');

  const [selectedCard, setSelectedCard] = useState<TarotCard | null>(null);
  const [cardTarget, setCardTarget] = useState('');
  const [isMutating, setIsMutating] = useState(false);
  const [uiMessage, setUiMessage] = useState('');
  const [liveAnimationActionId, setLiveAnimationActionId] = useState<number | null>(null);
  const [wheelSpinDegrees, setWheelSpinDegrees] = useState(0);
  const lastAnimatedActionIdRef = useRef<number | null>(null);
  const initializedRoomRef = useRef<string | null>(null);

  const userMap = useMemo(() => {
    const map = new Map<string, InternalUser>();
    users.forEach((user) => map.set(user.username, user));
    return map;
  }, [users]);

  const roomPlayerMap = useMemo(() => {
    const map = new Map<string, RoomPlayer>();
    roomPlayers.forEach((player) => map.set(player.username, player));
    return map;
  }, [roomPlayers]);

  const cardsById = useMemo(() => {
    const map = new Map<string, TarotCard>();
    TAROT_CARDS.forEach((card) => map.set(card.id, card));
    return map;
  }, []);

  const visibleRooms = useMemo(() => {
    if (!sessionUser) return [];
    if (sessionUser.role === 'master') return rooms;
    const ids = new Set(memberRoomIds);
    return rooms.filter((room) => ids.has(room.id));
  }, [memberRoomIds, rooms, sessionUser]);

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

  const winnerName = selectedRoom?.winner_username ? (userMap.get(selectedRoom.winner_username)?.display_name ?? selectedRoom.winner_username) : null;
  const isCurrentUserTurn = Boolean(sessionUser && currentTurnUsername === sessionUser.username);
  const isPlayerInRoom = Boolean(sessionUser && roomPlayerMap.get(sessionUser.username));
  const allReady = roomPlayers.length > 0 && roomPlayers.every((player) => player.is_ready);
  const liveAnimationAction = useMemo(() => {
    if (liveAnimationActionId == null) return null;
    return actions.find((action) => action.id === liveAnimationActionId) ?? null;
  }, [actions, liveAnimationActionId]);
  const liveAnimationCard = liveAnimationAction?.card_key ? cardsById.get(liveAnimationAction.card_key) ?? null : null;
  const liveAnimationActorName = liveAnimationAction ? (userMap.get(liveAnimationAction.actor_username)?.display_name ?? liveAnimationAction.actor_username) : '';
  const wheelMatch = liveAnimationAction?.description.match(/::WHEEL:([+-]?\d+)/i);
  const wheelResult = wheelMatch ? Number(wheelMatch[1]) : null;

  const toast = (message: string) => {
    setUiMessage(message);
    window.setTimeout(() => {
      setUiMessage((prev) => (prev === message ? '' : prev));
    }, 2600);
  };

  const fetchUsers = async () => {
    const { data, error } = await supabase.from('internal_users').select('*').eq('active', true).order('display_name');
    if (error) throw error;
    return (data ?? []) as InternalUser[];
  };

  const fetchRooms = async () => {
    const { data, error } = await supabase.from('game_rooms').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as GameRoom[];
  };

  const fetchMembership = async (username: string) => {
    const { data, error } = await supabase.from('room_players').select('room_id').eq('username', username);
    if (error) throw error;
    return (data ?? []).map((row) => row.room_id as string);
  };

  const loadRoomData = async (roomId: string) => {
    const [{ data: roomData, error: roomError }, { data: playersData, error: playersError }, { data: actionsData, error: actionsError }] =
      await Promise.all([
        supabase.from('game_rooms').select('*').eq('id', roomId).maybeSingle(),
        supabase.from('room_players').select('*').eq('room_id', roomId).order('joined_at'),
        supabase.from('game_actions').select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(30),
      ]);

    if (roomError) throw roomError;
    if (playersError) throw playersError;
    if (actionsError) throw actionsError;

    setSelectedRoom((roomData ?? null) as GameRoom | null);
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

    const allowed = sessionUser.role === 'master' ? roomsData : roomsData.filter((room) => membershipData.includes(room.id));
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
    if (!selectedRoomId || actions.length === 0) {
      setLiveAnimationActionId(null);
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

    if (lastAnimatedActionIdRef.current === latest.id) return;
    lastAnimatedActionIdRef.current = latest.id;

    if (!latest.card_key) return;

    setLiveAnimationActionId(latest.id);

    if (latest.card_key === 'wheel') {
      const values = [-2, -1, 0, 1, 2, 3];
      const match = latest.description.match(/::WHEEL:([+-]?\d+)/i);
      const rolled = match ? Number(match[1]) : 0;
      const index = Math.max(0, values.indexOf(rolled));
      const slice = 360 / values.length;
      const targetAngle = 360 - (index * slice + slice / 2);
      const turns = (Math.floor(Math.random() * 3) + 4) * 360;
      setWheelSpinDegrees(turns + targetAngle);
    }

    const timeoutMs = latest.card_key === 'wheel' ? 4300 : 2600;
    const timer = window.setTimeout(() => {
      setLiveAnimationActionId((prev) => (prev === latest.id ? null : prev));
    }, timeoutMs);

    return () => window.clearTimeout(timer);
  }, [actions, selectedRoomId]);

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
    setSelectedCard(null);
    setCardTarget('');
  };

  const handleCreateRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sessionUser || sessionUser.role !== 'master') return;
    const name = newRoomName.trim();
    if (!name) return;

    setIsMutating(true);
    try {
      const { data, error } = await supabase
        .from('game_rooms')
        .insert({
          name,
          created_by: sessionUser.username,
          status: 'waiting',
          turn_order: [],
          current_turn_index: 0,
        })
        .select('*')
        .single();

      if (error) throw error;
      setNewRoomName('');
      await refreshBaseData((data as GameRoom).id);
      toast('Sessao criada.');
    } catch (error) {
      console.error(error);
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

  const maybeAutoStartGame = async (roomId: string) => {
    const { data: roomData, error: roomError } = await supabase.from('game_rooms').select('*').eq('id', roomId).maybeSingle();
    if (roomError) throw roomError;

    const room = roomData as GameRoom | null;
    if (!room || room.status !== 'waiting') return;

    const { data: playersData, error: playersError } = await supabase.from('room_players').select('*').eq('room_id', roomId);
    if (playersError) throw playersError;

    const players = (playersData ?? []) as RoomPlayer[];
    if (players.length === 0 || players.some((player) => !player.is_ready)) return;

    const turnOrder = shuffle(players.map((player) => player.username));
    const now = new Date().toISOString();

    const { data: startedRoom, error: startError } = await supabase
      .from('game_rooms')
      .update({
        status: 'running',
        turn_order: turnOrder,
        current_turn_index: 0,
        winner_username: null,
        started_at: now,
        ended_at: null,
      })
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
      description: `Partida iniciada. Ordem aleatoria definida. Primeiro turno: ${firstName}.`,
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

    const mutable = roomPlayers.map((player) => ({ ...player }));
    const map = new Map(mutable.map((player) => [player.username, player]));
    const actor = map.get(sessionUser.username);
    if (!actor) {
      toast('Voce nao participa desta sessao.');
      return;
    }

    let target: RoomPlayer | undefined;
    if ('requiresTarget' in selectedCard.effect && selectedCard.effect.requiresTarget) {
      target = map.get(cardTarget);
      if (!target) {
        toast('Selecione um alvo.');
        return;
      }
    }

    const applyDelta = (player: RoomPlayer, delta: number) => {
      player.chips = Math.max(0, player.chips + delta);
    };

    const effect = selectedCard.effect;
    let wheelDelta: number | null = null;

    switch (effect.kind) {
      case 'self_delta':
        applyDelta(actor, effect.amount);
        break;
      case 'target_delta':
        applyDelta(target!, effect.amount);
        break;
      case 'steal': {
        const amount = Math.min(effect.amount, target!.chips);
        target!.chips -= amount;
        actor.chips += amount;
        break;
      }
      case 'give': {
        const amount = Math.min(effect.amount, actor.chips);
        actor.chips -= amount;
        target!.chips += amount;
        break;
      }
      case 'both_delta':
        applyDelta(actor, effect.actorAmount);
        applyDelta(target!, effect.targetAmount);
        break;
      case 'richest_to_actor': {
        const others = mutable.filter((player) => player.username !== actor.username);
        if (others.length > 0) {
          const richest = [...others].sort((a, b) => b.chips - a.chips)[0];
          const amount = Math.min(effect.amount, richest.chips);
          richest.chips -= amount;
          actor.chips += amount;
        } else {
          applyDelta(actor, effect.amount);
        }
        break;
      }
      case 'self_and_others': {
        const loss = effect.othersAmount;
        applyDelta(actor, effect.actorAmount);
        mutable.forEach((player) => {
          if (player.username !== actor.username) applyDelta(player, loss);
        });
        break;
      }
      case 'random_actor_delta': {
        const span = effect.max - effect.min + 1;
        const randomDelta = Math.floor(Math.random() * span) + effect.min;
        wheelDelta = randomDelta;
        applyDelta(actor, randomDelta);
        break;
      }
      case 'actor_gain_from_all': {
        const each = effect.amountEach;
        let total = 0;
        mutable.forEach((player) => {
          if (player.username === actor.username) return;
          const amount = Math.min(each, player.chips);
          player.chips -= amount;
          total += amount;
        });
        actor.chips += total;
        break;
      }
      case 'all_delta': {
        const delta = effect.amount;
        mutable.forEach((player) => applyDelta(player, delta));
        break;
      }
      default:
        break;
    }

    const beforeMap = new Map(roomPlayers.map((player) => [player.username, player.chips]));
    const changed = mutable.filter((player) => beforeMap.get(player.username) !== player.chips);

    const contenders = mutable.filter((player) => player.chips >= WIN_TARGET);
    const winner = contenders.length > 0 ? [...contenders].sort((a, b) => b.chips - a.chips)[0] : null;

    setIsMutating(true);
    try {
      await Promise.all(
        changed.map((player) =>
          supabase
            .from('room_players')
            .update({ chips: player.chips, last_action_at: new Date().toISOString() })
            .eq('room_id', selectedRoom.id)
            .eq('username', player.username)
        )
      );

      const order = selectedRoom.turn_order ?? [];
      const nextIndex = order.length > 0 ? (selectedRoom.current_turn_index + 1) % order.length : 0;

      const roomUpdate = winner
        ? { status: 'finished', winner_username: winner.username, ended_at: new Date().toISOString() }
        : { current_turn_index: nextIndex };

      const { error: roomError } = await supabase
        .from('game_rooms')
        .update(roomUpdate)
        .eq('id', selectedRoom.id)
        .eq('status', 'running');

      if (roomError) throw roomError;

      const actorName = userMap.get(actor.username)?.display_name ?? actor.username;
      const targetName = target ? userMap.get(target.username)?.display_name ?? target.username : null;
      const wheelLog = wheelDelta != null ? ` Resultado da roleta: ${formatSigned(wheelDelta)}.` : '';
      const wheelMeta = wheelDelta != null ? ` ::WHEEL:${formatSigned(wheelDelta)}` : '';
      const baseLog = `${actorName} jogou ${selectedCard.name}.${targetName ? ` Alvo: ${targetName}.` : ''}${wheelLog}`;

      const description = winner
        ? `${baseLog} ${userMap.get(winner.username)?.display_name ?? winner.username} venceu a partida!${wheelMeta}`
        : `${baseLog} Proximo turno: ${userMap.get(order[nextIndex] ?? '')?.display_name ?? order[nextIndex] ?? '-'}.${wheelMeta}`;

      const { error: actionError } = await supabase.from('game_actions').insert({
        room_id: selectedRoom.id,
        actor_username: actor.username,
        target_username: target?.username ?? null,
        card_key: selectedCard.id,
        description,
      });

      if (actionError) throw actionError;

      setSelectedCard(null);
      setCardTarget('');
      toast(winner ? 'Temos um vencedor!' : 'Jogada aplicada.');
    } catch (error) {
      console.error(error);
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
    const nextIndex = (selectedRoom.current_turn_index + 1) % order.length;

    setIsMutating(true);
    try {
      const { error } = await supabase
        .from('game_rooms')
        .update({ current_turn_index: nextIndex })
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
        description: `${actorName} encerrou a rodada sem carta. Proximo turno: ${nextName}.`,
      });
      toast('Rodada encerrada.');
    } catch (error) {
      console.error(error);
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
        description: 'Nova partida preparada. Aguardando todos marcarem pronto.',
      });

      toast('Nova partida pronta.');
    } catch (error) {
      console.error(error);
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
        </div>
      </div>
    );
  }

  const meInRoom = sessionUser ? roomPlayerMap.get(sessionUser.username) : undefined;
  const playersSorted = [...roomPlayers].sort((a, b) => b.chips - a.chips);
  const availablePlayers = users.filter((user) => user.role === 'player' && !roomPlayerMap.has(user.username));
  const canShowCards = selectedRoom?.status === 'running' && isCurrentUserTurn && isPlayerInRoom;
  const targetCandidates = roomPlayers.filter((player) => player.username !== sessionUser.username);
  const wheelSlots = [-2, -1, 0, 1, 2, 3];

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
          </div>
          <button className="ghost-btn" onClick={handleLogout}>Sair</button>
        </header>

        <section className="panel room-panel">
          <div>
            <h2>Secoes de jogo</h2>
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
              <form onSubmit={handleCreateRoom} className="form-inline">
                <input value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} placeholder="Nome da sessao" />
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
                <p className="muted">Jogador da vez: <strong>{currentTurnUsername ? userMap.get(currentTurnUsername)?.display_name ?? currentTurnUsername : '-'}</strong></p>
                <p className="muted">Proximo jogador: <strong>{nextTurnUsername ? userMap.get(nextTurnUsername)?.display_name ?? nextTurnUsername : '-'}</strong></p>
                {selectedRoom.status === 'waiting' && (
                  <p className="muted">Prontos: {roomPlayers.filter((p) => p.is_ready).length}/{roomPlayers.length} {allReady ? '- iniciando...' : ''}</p>
                )}
                {selectedRoom.status === 'finished' && winnerName && <p className="winner-banner">Vencedor: {winnerName}</p>}
                {selectedRoom.status === 'finished' && (
                  <div className="button-row">
                    <button onClick={resetMatch} disabled={isMutating}>Iniciar nova partida</button>
                    <button className="ghost-btn" onClick={() => setSelectedRoomId(null)}>Voltar ao menu</button>
                  </div>
                )}
              </article>

              <article className="panel">
                <h2>Placar</h2>
                <div className="scoreboard">
                  {playersSorted.map((player) => {
                    const displayName = userMap.get(player.username)?.display_name ?? player.username;
                    const isWinner = player.chips >= WIN_TARGET;
                    return (
                      <div key={player.id} className={`score-row ${isWinner ? 'winner' : ''}`}>
                        <div>
                          <strong>{displayName}</strong>
                          <p>{player.is_ready ? 'Pronto' : 'Aguardando'} {currentTurnUsername === player.username ? '• turno atual' : ''}</p>
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
                <h2>Baralho Arcano</h2>
                <p className="muted">{canShowCards ? 'Seu turno: escolha uma carta.' : 'Cartas ativas somente para o jogador da vez.'}</p>
              </div>
              <div className="cards-grid">
                {TAROT_CARDS.map((card) => (
                  <button
                    key={card.id}
                    className={`tarot-card ${canShowCards ? '' : 'locked'}`}
                    disabled={!canShowCards}
                    onClick={() => {
                      setSelectedCard(card);
                      setCardTarget('');
                    }}
                    style={{ background: `linear-gradient(160deg, ${card.palette[0]}dd, ${card.palette[1]}dd)` }}
                  >
                    <p>{card.arcana}</p>
                    <span>{card.symbol}</span>
                    <h3>{card.name}</h3>
                    <small>{card.effectText}</small>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        {selectedCard && (
          <div className="modal-backdrop" onClick={() => setSelectedCard(null)}>
            <div className="card-modal" onClick={(event) => event.stopPropagation()}>
              <button className="close-btn" onClick={() => setSelectedCard(null)}>x</button>
              <div className="modal-illustration" style={{ background: `linear-gradient(160deg, ${selectedCard.palette[0]}dd, ${selectedCard.palette[1]}dd)` }}>{selectedCard.symbol}</div>
              <div className="modal-content">
                <p className="eyebrow">{selectedCard.arcana}</p>
                <h3>{selectedCard.name}</h3>
                <p><strong>Efeito:</strong> {selectedCard.effectText}</p>
                <p><strong>Leitura:</strong> {selectedCard.meaning}</p>

                {'requiresTarget' in selectedCard.effect && selectedCard.effect.requiresTarget && (
                  <select value={cardTarget} onChange={(event) => setCardTarget(event.target.value)}>
                    <option value="">Selecione o alvo</option>
                    {targetCandidates.map((candidate) => (
                      <option key={candidate.username} value={candidate.username}>{userMap.get(candidate.username)?.display_name ?? candidate.username}</option>
                    ))}
                  </select>
                )}

                <button onClick={applyCardEffect} disabled={isMutating}>Aplicar efeito</button>
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
                    <div className="wheel-pointer">▼</div>
                    <div className="wheel-disc" style={{ transform: `rotate(${wheelSpinDegrees}deg)` }}>
                      {wheelSlots.map((slot, index) => (
                        <span
                          key={`wheel-slot-${slot}`}
                          className="wheel-slot"
                          style={{ transform: `rotate(${index * 60}deg) translateY(-84px) rotate(${-index * 60}deg)` }}
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

        {uiMessage && <div className="toast">{uiMessage}</div>}
      </main>
    </div>
  );
}

export default App;

