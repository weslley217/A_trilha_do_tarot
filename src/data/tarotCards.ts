import type { TarotCard, TarotCardRule } from '../types';

const MAJOR_ARCANA: TarotCard[] = [
  {
    id: 'fool',
    arcana: 'Arcano 0',
    name: 'O Louco',
    symbol: '🎒',
    palette: ['#6b59cc', '#2f1f58'],
    group: 'major',
    rules: [
      {
        id: 'fool_h1',
        effect: { kind: 'fool_h1' },
        effectText: 'Todos reembaralham suas maos e ficam com 1 ponto; o portador fica com 3.',
        flavorText: 'A loucura reinicia o destino e favorece quem ousa lançar o caos.',
      },
      {
        id: 'fool_h2',
        effect: { kind: 'fool_h2' },
        effectText: 'Tome a mao e os pontos de um jogador; os demais perdem pontos ate 1 e reembaralham as maos.',
        flavorText: 'A troca de papeis desmonta certezas e abre uma nova trilha.',
        targetCount: 1,
      },
    ],
  },
  {
    id: 'magician',
    arcana: 'Arcano I',
    name: 'O Mago',
    symbol: '🪄',
    palette: ['#9a4bd8', '#3a1f4f'],
    group: 'major',
    rules: [
      {
        id: 'magician_h1',
        effect: { kind: 'magician_h1' },
        effectText: 'Perde 2 pontos e compra 2 cartas.',
        flavorText: 'Para moldar a realidade, o Mago sacrifica energia e amplia recursos.',
      },
      {
        id: 'magician_h2',
        effect: { kind: 'magician_h2' },
        effectText: 'Ativa a habilidade de outra carta da sua mao; se nao tiver, ganha 2 pontos.',
        flavorText: 'A canalizacao perfeita ecoa o poder de outro arcano.',
      },
    ],
  },
  {
    id: 'priestess',
    arcana: 'Arcano II',
    name: 'A Alta Sacerdotisa',
    symbol: '🌙',
    palette: ['#466ed8', '#172447'],
    group: 'major',
    rules: [
      {
        id: 'priestess_h1',
        effect: { kind: 'priestess_h1' },
        effectText: 'O jogador com menos pontos joga agora e puxa 2 cartas.',
        flavorText: 'O silencio da sacerdotisa eleva quem está no fundo da maré.',
      },
      {
        id: 'priestess_h2',
        effect: { kind: 'priestess_h2' },
        effectText: 'O jogador com menos pontos recebe 4 pontos.',
        flavorText: 'A intuicao restaura quem mais necessita de luz.',
      },
    ],
  },
  {
    id: 'empress',
    arcana: 'Arcano III',
    name: 'A Imperatriz',
    symbol: '👑',
    palette: ['#d3659a', '#511d3c'],
    group: 'major',
    rules: [
      {
        id: 'empress_h1',
        effect: { kind: 'empress_h1' },
        effectText: 'O portador ganha 5 pontos.',
        flavorText: 'A abundancia transborda e acelera o crescimento pessoal.',
      },
      {
        id: 'empress_h2',
        effect: { kind: 'empress_h2' },
        effectText: 'O portador escolhe a nova ordem de jogo para todos.',
        flavorText: 'A soberana redesenha o ritmo da mesa conforme sua vontade.',
        requiresOrderSelection: true,
      },
    ],
  },
  {
    id: 'emperor',
    arcana: 'Arcano IV',
    name: 'O Imperador',
    symbol: '🛡️',
    palette: ['#d09b50', '#4f3113'],
    group: 'major',
    rules: [
      {
        id: 'emperor_h1',
        effect: { kind: 'emperor_h1' },
        effectText: 'Ganha 3 pontos e ativa escudo secreto contra alvo (1 uso).',
        flavorText: 'A muralha imperial bloqueia a investida inimiga no instante decisivo.',
        isSecret: true,
      },
      {
        id: 'emperor_h2',
        effect: { kind: 'emperor_h2' },
        effectText: 'Ganha 3 pontos e ativa reflexo secreto para anular um alvo e tomar a carta.',
        flavorText: 'O trono absorve o golpe e devolve a força ao agressor.',
        isSecret: true,
      },
    ],
  },
  {
    id: 'hierophant',
    arcana: 'Arcano V',
    name: 'O Hierofante',
    symbol: '⛪',
    palette: ['#7ec7be', '#20403e'],
    group: 'major',
    rules: [
      {
        id: 'hierophant_h1',
        effect: { kind: 'hierophant_h1' },
        effectText: 'Escolha 2 jogadores para ganharem 2 pontos.',
        flavorText: 'A benção dupla fortalece alianças sob a mesma doutrina.',
        targetCount: 2,
      },
      {
        id: 'hierophant_h2',
        effect: { kind: 'hierophant_h2' },
        effectText: 'Os 2 jogadores com menos pontos ganham 3 pontos.',
        flavorText: 'A tradição ampara os que mais precisam de base.',
      },
    ],
  },
  {
    id: 'lovers',
    arcana: 'Arcano VI',
    name: 'Os Amantes',
    symbol: '💞',
    palette: ['#d282b4', '#4c1d3b'],
    group: 'major',
    rules: [
      {
        id: 'lovers_h1',
        effect: { kind: 'lovers_h1' },
        effectText: 'Portador e outro jogador ganham 2 pontos e ativam elo secreto de pontos.',
        flavorText: 'Os destinos se entrelaçam e vibram na mesma frequência.',
        targetCount: 1,
        isSecret: true,
      },
      {
        id: 'lovers_h2',
        effect: { kind: 'lovers_h2' },
        effectText: 'Portador e outro jogador puxam 1 carta extra e ativam elo secreto.',
        flavorText: 'A uniao desperta ganhos espelhados até o vínculo ser cobrado.',
        targetCount: 1,
        isSecret: true,
      },
    ],
  },
  {
    id: 'chariot',
    arcana: 'Arcano VII',
    name: 'A Carruagem',
    symbol: '🏇',
    palette: ['#5c95df', '#1e3359'],
    group: 'major',
    rules: [
      {
        id: 'chariot_h1',
        effect: { kind: 'chariot_h1' },
        effectText: 'Ganha 3 pontos e joga novamente.',
        flavorText: 'A arrancada perfeita quebra o ritmo e mantém seu turno vivo.',
      },
      {
        id: 'chariot_h2',
        effect: { kind: 'chariot_h2' },
        effectText: 'Ganha 3 pontos e ativa contragolpe secreto para virar o próximo turno se for alvo.',
        flavorText: 'A carruagem retorna ao campo no instante do ataque rival.',
        isSecret: true,
      },
    ],
  },
  {
    id: 'strength',
    arcana: 'Arcano VIII',
    name: 'A Forca',
    symbol: '🦁',
    palette: ['#de8d58', '#5c2c14'],
    group: 'major',
    rules: [
      {
        id: 'strength_h1',
        effect: { kind: 'strength_h1' },
        effectText: 'Rouba 1 ponto de cada jogador.',
        flavorText: 'A firmeza interior domina a mesa e puxa poder coletivo.',
      },
      {
        id: 'strength_h2',
        effect: { kind: 'strength_h2' },
        effectText: 'Rouba 1 carta de cada jogador e escolhe uma para jogar imediatamente.',
        flavorText: 'A força captura opções alheias e converte em ação.',
      },
    ],
  },
  {
    id: 'hermit',
    arcana: 'Arcano IX',
    name: 'O Eremita',
    symbol: '🕯️',
    palette: ['#99887a', '#2e2924'],
    group: 'major',
    rules: [
      {
        id: 'hermit_h1',
        effect: { kind: 'hermit_h1' },
        effectText: 'Nao joga no proximo turno; ao voltar ganha 6 pontos.',
        flavorText: 'No retiro, o eremita acumula luz para um retorno absoluto.',
      },
      {
        id: 'hermit_h2',
        effect: { kind: 'hermit_h2' },
        effectText: 'Ganha 3 pontos e nao pode ser alvo ate seu proximo turno.',
        flavorText: 'O manto de isolamento blinda seu caminho por um ciclo.',
        isSecret: true,
      },
    ],
  },
  {
    id: 'wheel',
    arcana: 'Arcano X',
    name: 'A Roda da Fortuna',
    symbol: '🎡',
    palette: ['#e0ad6e', '#5d3c1b'],
    group: 'major',
    rules: [
      {
        id: 'wheel_h1',
        effect: { kind: 'wheel_h1' },
        effectText: 'Roleta decide entre perder 3 pontos ou ganhar ate 6.',
        flavorText: 'A roda vira sem aviso e entrega extremos de sorte.',
      },
      {
        id: 'wheel_h2',
        effect: { kind: 'wheel_h2' },
        effectText: 'Escolha 2 jogadores para disputar sorte: um perde 3, outro ganha 3.',
        flavorText: 'Dois destinos sob o mesmo giro nunca saem iguais.',
        targetCount: 2,
      },
    ],
  },
  {
    id: 'justice',
    arcana: 'Arcano XI',
    name: 'A Justica',
    symbol: '⚖️',
    palette: ['#b86fd4', '#382044'],
    group: 'major',
    rules: [
      {
        id: 'justice_h1',
        effect: { kind: 'justice_h1' },
        effectText: 'Soma os pontos de todos e redistribui igualmente (arredondado para cima).',
        flavorText: 'A balança redefine o valor de cada trilha em nome do equilibrio.',
      },
      {
        id: 'justice_h2',
        effect: { kind: 'justice_h2' },
        effectText: 'Todos ficam com menos pontos que o jogador com menos pontos.',
        flavorText: 'A sentença reduz o excesso e nivela por baixo.',
      },
    ],
  },
  {
    id: 'hanged_man',
    arcana: 'Arcano XII',
    name: 'O Enforcado',
    symbol: '🙃',
    palette: ['#5c8cb9', '#233349'],
    group: 'major',
    rules: [
      {
        id: 'hanged_man_h1',
        effect: { kind: 'hanged_man_h1' },
        effectText: 'Nao joga no proximo turno; ao voltar perde 3 pontos.',
        flavorText: 'A suspensão cobra preço quando a roda volta a girar.',
      },
      {
        id: 'hanged_man_h2',
        effect: { kind: 'hanged_man_h2' },
        effectText: 'Perde 5 pontos e escolhe um jogador para perder um turno.',
        flavorText: 'A inversao derruba dois caminhos ao mesmo tempo.',
        targetCount: 1,
      },
    ],
  },
  {
    id: 'death',
    arcana: 'Arcano XIII',
    name: 'A Morte',
    symbol: '💀',
    palette: ['#7e7b8c', '#2f2d3f'],
    group: 'major',
    rules: [
      {
        id: 'death_h1',
        effect: { kind: 'death_h1' },
        effectText: 'Perde todos os pontos e descarta a mao (A Morte volta ao baralho).',
        flavorText: 'O fim do ciclo dissolve o que foi acumulado para renascer depois.',
      },
      {
        id: 'death_h2',
        effect: { kind: 'death_h2' },
        effectText: 'Escolha um jogador: ambos saem da partida e descartam as maos (A Morte retorna ao baralho).',
        flavorText: 'A travessia final leva dois destinos de uma vez.',
        targetCount: 1,
      },
    ],
  },
  {
    id: 'temperance',
    arcana: 'Arcano XIV',
    name: 'A Temperanca',
    symbol: '🕊️',
    palette: ['#7dc4d4', '#225268'],
    group: 'major',
    rules: [
      {
        id: 'temperance_h1',
        effect: { kind: 'temperance_h1' },
        effectText: 'Ganha metade dos pontos do jogador com mais pontos.',
        flavorText: 'A alquimia da medida converte excesso alheio em ganho próprio.',
      },
      {
        id: 'temperance_h2',
        effect: { kind: 'temperance_h2' },
        effectText: 'Dois com mais pontos perdem metade; os com menos dobram seus pontos.',
        flavorText: 'A mistura dos extremos reequilibra a mesa por contraste.',
      },
    ],
  },
  {
    id: 'devil',
    arcana: 'Arcano XV',
    name: 'O Diabo',
    symbol: '😈',
    palette: ['#b24646', '#4b1717'],
    group: 'major',
    rules: [
      {
        id: 'devil_h1',
        effect: { kind: 'devil_h1' },
        effectText: 'Escolha um jogador para ganhar ate 3 pontos; no proximo turno ele perde o dobro do que ganhou.',
        flavorText: 'O pacto oferece prazer imediato e cobra caro no retorno.',
        targetCount: 1,
      },
      {
        id: 'devil_h2',
        effect: { kind: 'devil_h2' },
        effectText: 'Voce ganha ate 3 pontos; no proximo turno perde o dobro do ganho.',
        flavorText: 'A tentacao fortalece agora e drena depois.',
      },
    ],
  },
  {
    id: 'tower',
    arcana: 'Arcano XVI',
    name: 'A Torre',
    symbol: '⛈️',
    palette: ['#7e83df', '#262a64'],
    group: 'major',
    rules: [
      {
        id: 'tower_h1',
        effect: { kind: 'tower_h1' },
        effectText: 'Todos perdem ate 5 pontos.',
        flavorText: 'O raio derruba estruturas e espalha ruina coletiva.',
      },
      {
        id: 'tower_h2',
        effect: { kind: 'tower_h2' },
        effectText: 'Voce perde 5 pontos e compra 1 carta sem acionar seu efeito.',
        flavorText: 'Do caos nasce oportunidade, mas com custo imediato.',
      },
    ],
  },
  {
    id: 'star',
    arcana: 'Arcano XVII',
    name: 'A Estrela',
    symbol: '⭐',
    palette: ['#78b8ff', '#2c4f7c'],
    group: 'major',
    rules: [
      {
        id: 'star_h1',
        effect: { kind: 'star_h1' },
        effectText: 'Tome ate 3 pontos do jogador com mais pontos.',
        flavorText: 'A esperança atrai luz até de quem brilha mais forte.',
      },
      {
        id: 'star_h2',
        effect: { kind: 'star_h2' },
        effectText: 'Tome uma carta da mao de um jogador e use seu efeito.',
        flavorText: 'A estrela guia sua mão para o recurso exato.',
        targetCount: 1,
      },
    ],
  },
  {
    id: 'moon',
    arcana: 'Arcano XVIII',
    name: 'A Lua',
    symbol: '🌘',
    palette: ['#4f67c0', '#1f2c61'],
    group: 'major',
    rules: [
      {
        id: 'moon_h1',
        effect: { kind: 'moon_h1' },
        effectText: 'Jogador com menos cartas ganha 3 pontos; se alguem tiver O Sol, ele perde 3.',
        flavorText: 'A sombra beneficia o discreto e cobra do brilho oposto.',
      },
      {
        id: 'moon_h2',
        effect: { kind: 'moon_h2' },
        effectText: 'Jogador com mais cartas perde 3; se alguem tiver O Sol, ele ganha 3.',
        flavorText: 'Quando a noite domina, o excesso paga pedágio.',
      },
    ],
  },
  {
    id: 'sun',
    arcana: 'Arcano XIX',
    name: 'O Sol',
    symbol: '☀️',
    palette: ['#f4bd53', '#5b3f17'],
    group: 'major',
    rules: [
      {
        id: 'sun_h1',
        effect: { kind: 'sun_h1' },
        effectText: 'Jogue novamente; se alguem tiver A Lua, ele nao joga no proximo turno.',
        flavorText: 'A luz absoluta acelera sua marcha e eclipsa a noite.',
      },
      {
        id: 'sun_h2',
        effect: { kind: 'sun_h2' },
        effectText: 'Ganha 3 pontos; se alguem tiver A Lua, toma ate 3 pontos dele.',
        flavorText: 'O brilho solar absorve as reservas da escuridão.',
      },
    ],
  },
  {
    id: 'judgement',
    arcana: 'Arcano XX',
    name: 'O Julgamento',
    symbol: '📯',
    palette: ['#5fa7b2', '#1a3a42'],
    group: 'major',
    rules: [
      {
        id: 'judgement_h1',
        effect: { kind: 'judgement_h1' },
        effectText: 'Jogador com mais pontos perde metade e concede ao de menos pontos.',
        flavorText: 'O chamado final redistribui destino e responsabilidade.',
      },
      {
        id: 'judgement_h2',
        effect: { kind: 'judgement_h2' },
        effectText: 'Escolha um jogador para perder metade e conceder ao de menos pontos.',
        flavorText: 'A sentença dirige a transferência com precisão ritual.',
        targetCount: 1,
      },
    ],
  },
  {
    id: 'world',
    arcana: 'Arcano XXI',
    name: 'O Mundo',
    symbol: '🌍',
    palette: ['#66c58d', '#1e4b2f'],
    group: 'major',
    rules: [
      {
        id: 'world_h1',
        effect: { kind: 'world_h1' },
        effectText: 'Ganhe 7 pontos.',
        flavorText: 'A completude do ciclo entrega recompensa máxima.',
      },
      {
        id: 'world_h2',
        effect: { kind: 'world_h2' },
        effectText: 'Compre 3 cartas.',
        flavorText: 'Com o mundo em mãos, novos caminhos se abrem.',
      },
    ],
  },
];

const suitMeta: Record<string, { symbol: string; palette: [string, string]; group: TarotCard['group'] }> = {
  paus: { symbol: '🪵', palette: ['#b67a43', '#4f3013'], group: 'wands' },
  copas: { symbol: '🏆', palette: ['#7cb5d8', '#22435c'], group: 'cups' },
  espadas: { symbol: '⚔️', palette: ['#9ea6bf', '#343b52'], group: 'swords' },
  ouros: { symbol: '🪙', palette: ['#d3a24e', '#5a3b13'], group: 'pentacles' },
};

const minorRanks = ['As', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Pajem', 'Cavaleiro', 'Rainha', 'Rei'];

function buildMinorRule(suit: keyof typeof suitMeta, rank: string): TarotCardRule {
  const rankValue = minorRanks.indexOf(rank) + 1;
  const intensity = Math.max(1, Math.ceil(rankValue / 4));

  if (suit === 'espadas') {
    if (rank === '10') {
      return {
        id: `minor_${suit}_${rank}`,
        effect: { kind: 'minor_swords_cut_deck', amount: 0 },
        effectText: 'Corte metade do baralho de compra.',
        flavorText: 'A lâmina separa destino e encurta o caminho restante.',
      };
    }
    return {
      id: `minor_${suit}_${rank}`,
      effect: { kind: 'minor_swords_target_loss', amount: intensity + 1 },
      effectText: `Escolha um alvo para perder ate ${intensity + 1} pontos.`,
      flavorText: 'A espada corta excesso e impõe disciplina imediata.',
      targetCount: 1,
    };
  }

  if (suit === 'copas') {
    return {
      id: `minor_${suit}_${rank}`,
      effect: { kind: 'minor_cups_gain', amount: intensity + 1 },
      effectText: `Ganhe ${intensity + 1} pontos.`,
      flavorText: 'As copas nutrem emoções e restauram sua força.',
    };
  }

  if (suit === 'ouros') {
    return {
      id: `minor_${suit}_${rank}`,
      effect: { kind: 'minor_pentacles_trade', amount: intensity + 1 },
      effectText: `Roube ate ${intensity + 1} pontos de um alvo.`,
      flavorText: 'Os ouros movimentam valor e mudam a balança do jogo.',
      targetCount: 1,
    };
  }

  return {
    id: `minor_${suit}_${rank}`,
    effect: { kind: 'minor_wands_draw_or_turn', amount: intensity },
    effectText: `Compre ${Math.max(1, intensity - 1)} carta(s) e avance 1 turno extra.`,
    flavorText: 'Os paus acendem iniciativa e aceleram a trilha.',
  };
}

const MINOR_ARCANA: TarotCard[] = (Object.keys(suitMeta) as Array<keyof typeof suitMeta>).flatMap((suit) =>
  minorRanks.map((rank) => {
    const meta = suitMeta[suit];
    return {
      id: `minor_${suit}_${rank.toLowerCase().replace(/\s+/g, '_')}`,
      arcana: `Arcano Menor - ${suit.toUpperCase()}`,
      name: `${rank} de ${suit[0].toUpperCase()}${suit.slice(1)}`,
      symbol: meta.symbol,
      palette: meta.palette,
      group: meta.group,
      suit,
      rank,
      rules: [buildMinorRule(suit, rank)],
    } as TarotCard;
  })
);

export const TAROT_CARDS: TarotCard[] = [...MAJOR_ARCANA, ...MINOR_ARCANA];
export const MAJOR_ARCANA_IDS = new Set(MAJOR_ARCANA.map((card) => card.id));

