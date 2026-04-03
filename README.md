# A Trilha do Tarot

Dashboard web em tempo real para noite de jogos usando React + Supabase.

## O que o projeto entrega

- Login interno sem cadastro publico.
- Usuario mestre (`mestre / 123456`) com aba mestre para:
  - criar sessoes de jogo
  - cadastrar jogadores internos
  - adicionar/remover jogadores de uma sessao
- Jogadores com senha padrao `1234`.
- Sessao inicial ja criada: **Sessao Principal** com:
  - Joao
  - Milena
  - Rayanne
  - Daniel
  - Barbara
  - Weslley
- Modo pronto: quando todos da sessao marcam pronto, a partida inicia automaticamente com ordem aleatoria.
- Turno em tempo real: quem joga agora e quem joga depois.
- Cartas do tarot com visual mistico, efeito e leitura simbolica.
- Fichas atualizadas ao vivo para todos os celulares.
- Vitoria ao chegar em 10 fichas.
- Ao finalizar: opcao de iniciar nova partida ou voltar ao menu.

## Stack

- React + Vite + TypeScript
- Supabase (`@supabase/supabase-js`) com realtime via `postgres_changes`

## Configuracao do Supabase

1. Abra o SQL Editor do seu projeto Supabase.
2. Execute o script [supabase/schema.sql](./supabase/schema.sql).
3. Confirme que as tabelas foram criadas e que a sessao inicial foi semeada.

### Banco ja existente (migracao rapida)

Se o banco ja estava em uso antes das colunas de modo/estado, execute tambem:

- [supabase/20260403_add_mode_state_columns.sql](./supabase/20260403_add_mode_state_columns.sql)

Sem essa migracao, o app entra em modo de compatibilidade automaticamente.

## Variaveis de ambiente

Use o arquivo `.env.local` (ja criado localmente) ou copie de `.env.example`.

```bash
VITE_SUPABASE_URL=https://hmqznjjfzllkxeqqjrzm.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_iqgn7xc6giRLAFEKiDfnHA_rzkErpeH
```

> Importante: a secret key do Supabase **nao** deve ser usada no frontend nem commitada no Git.

## Rodando localmente

```bash
npm install
npm run dev
```

## Build de producao

```bash
npm run build
```

## Deploy na Vercel

1. Suba o repositorio para o GitHub.
2. Importe o repositorio na Vercel.
3. Configure as variaveis:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy.

## Credenciais iniciais

- Mestre:
  - login: `mestre`
  - senha: `123456`
- Jogadores:
  - `joao`
  - `milena`
  - `rayanne`
  - `daniel`
  - `barbara`
  - `weslley`
  - senha de todos: `1234`

Tambem e possivel entrar pelo nome exibido (ex.: `Milena`).

