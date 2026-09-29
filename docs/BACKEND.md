# Night Cruise — contas e banco de dados

O jogo continua sendo um site estático no GitHub Pages (`www.nightcruisegame.com`), sem etapa de build.
As contas e os dados dos jogadores ficam no **Supabase**: PostgreSQL + Supabase Auth.
Sem backend configurado (ou para quem não entra numa conta) o jogo funciona exatamente como antes.

## Arquitetura

```
 navegador (GitHub Pages)                      Supabase
 ┌───────────────────────┐   HTTPS + JWT   ┌──────────────────────────────────────┐
 │ index.html + js/*.js  │ ──────────────► │ Auth: cadastro, login, sessão, e-mail │
 │ js/account.js         │                 │ Data API ─► PostgreSQL                │
 │  (supabase-js via CDN)│                 │   RLS + permissões por coluna         │
 └───────────────────────┘                 │   funções SECURITY DEFINER (RPC)      │
        │ captcha (Turnstile)              └──────────────────────────────────────┘
        ▼                                         │ e-mails (SMTP)
   Cloudflare Turnstile                           ▼
                                               Resend
```

- **Autenticação:** Supabase Auth. Senhas com hash bcrypt, nunca vistas pelo jogo nem pelo banco do jogo. Confirmação de e-mail, recuperação e troca de senha, sessão persistente com renovação automática do token.
- **Autorização:** no banco. Row Level Security: cada jogador só lê as próprias linhas. Permissões por coluna: o jogador só escreve `settings` e `selected_car` do próprio perfil.
- **Progresso (distância, tempo, desbloqueios, conquistas, recordes):** o navegador **não tem permissão de escrita**. Só funções no servidor (`report_drive`, `start_drive`...) alteram esses dados, depois de conferir se são plausíveis.
- **Chaves no navegador:** só a URL do projeto e a chave pública (anon/publishable), feitas para serem públicas. Nenhum segredo vai para o GitHub.

### Limite importante: antitrapaça
A física roda no navegador, então o servidor não consegue provar o que aconteceu dentro do jogo. Ele aplica regras de plausibilidade:
- tempo relatado ≤ tempo real passado;
- distância ≤ tempo × 125 m/s (450 km/h, acima de qualquer carro);
- no mínimo 5 s entre relatos;
- carro precisa existir e estar desbloqueado.

Relatos impossíveis não contam e ficam registrados em `player_stats.rejected_reports`. Isso impede a trapaça simples (editar uma requisição), mas não um trapaceiro dedicado.

## Arquivos

| Arquivo | O que é |
|---|---|
| `js/account.js` | Integração no jogo: configuração pública (`BACKEND`), telas, sincronização de configurações, relatos de viagem |
| `index.html` | Tela `#account` (login, cadastro, esqueci a senha, nova senha, perfil, excluir conta), botão "Entrar/Perfil", indicador do jogador |
| `js/settings.js` | `SYNCED`, `syncedPart`, `applySynced` (valida o que vem da conta) e `onSave` |
| `js/i18n.js` | Textos das telas de conta (pt/en) |
| `js/input.js` | Digitação em campos de texto não vira comando do carro |
| `supabase/migrations/*.sql` | Esquema do banco, RLS, permissões e funções |
| `supabase/config.toml` | Configuração do Auth (URLs, senha mínima, confirmação de e-mail, captcha, SMTP, modelos de e-mail) |
| `supabase/templates/*.html` | E-mails de confirmação, nova senha e troca de e-mail |
| `supabase/tests/db.test.mjs` | Testes do banco (`npm run test:db`) |
| `.github/workflows/db-backup.yml` | Backup diário criptografado |

## Banco de dados

| Tabela | Conteúdo | Leitura | Escrita pelo jogador |
|---|---|---|---|
| `cars` | catálogo de carros jogáveis (`unlocked_by_default`) | todos | — |
| `achievements` | catálogo de conquistas | todos | — |
| `profiles` | `username` (único, sem diferença de maiúsculas), `created_at`, `last_seen_at`, `selected_car`, `settings` (jsonb ≤ 16 KB), `settings_updated_at` | o próprio (admin: todos) | `settings`, `selected_car` |
| `player_stats` | `distance_m`, `play_time_s`, `drives`, `rejected_reports` | o próprio | — (só `report_drive`/`start_drive`) |
| `drive_sessions` | uma linha por viagem, com o relógio do servidor | o próprio | — |
| `car_unlocks` | carros liberados por jogador (origem: default/achievement/event/admin) | o próprio | — |
| `player_achievements` | conquistas obtidas | o próprio | — |
| `records` | recordes pessoais (`kind`, `car_id`, `value`, `details`) | o próprio | — |

O e-mail e a senha ficam em `auth.users` (Supabase Auth). Tudo do jogador tem `on delete cascade`: excluir a conta apaga todos os dados dela.

### Funções chamadas pelo jogo (RPC)

| Função | Quem | O que faz |
|---|---|---|
| `username_available(p_name)` | anon, jogador | nome livre e válido? |
| `set_username(p_name)` | jogador | troca o nome (1 vez por dia; nomes reservados como *admin*, *nightcruise*, *support* são recusados) |
| `touch_last_seen()` | jogador | atualiza o último acesso (no máximo 1 vez por minuto) |
| `start_drive(p_car)` | jogador | abre uma viagem (carro precisa estar liberado) e conta +1 viagem |
| `report_drive(p_session, p_distance_m, p_seconds)` | jogador | soma distância e tempo, se plausíveis |
| `delete_my_account()` | jogador | exclui a conta; exige senha digitada nos últimos 10 min |

Um trigger (`on_auth_user_created`) cria o perfil, as estatísticas e os desbloqueios padrão quando alguém se cadastra.

Os dados que vão para a conta são as configurações que seguem o jogador entre aparelhos (áudio, jogo, teclas, controle, idioma, carro, cores), mais a distância e o tempo de direção. Gráficos e tela ficam por aparelho.

## Variáveis e segredos

| Nome | Onde fica | Público? |
|---|---|---|
| URL do projeto (`https://<ref>.supabase.co`) | `js/account.js` → `BACKEND.url` | sim |
| Chave anon/publishable | `js/account.js` → `BACKEND.anonKey` | sim (só permite o que o RLS deixa) |
| Site key do Turnstile | `js/account.js` → `BACKEND.turnstileSiteKey` | sim |
| `TURNSTILE_SECRET_KEY` | Supabase (Auth → captcha) | **não** |
| `RESEND_API_KEY` | Supabase (Auth → SMTP) | **não** |
| Senha do banco | seu gerenciador de senhas; CLI no `link` | **não** |
| `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE` | GitHub → Secrets (backup) | **não** |
| service_role key | não é usada pelo jogo; nunca no navegador nem no repositório | **não** |

## Colocar em produção (passo a passo)

1. **Supabase:** crie a conta e um projeto (região *South America (São Paulo)*). Guarde a senha do banco num gerenciador de senhas.
2. **Resend (e-mails):** crie a conta e adicione o domínio `nightcruisegame.com`. O Resend mostra os registros DNS (SPF e DKIM, em TXT/MX). Adicione-os no painel de DNS da **Wix** e espere a verificação. Crie uma API key com permissão só de envio.
3. **Cloudflare Turnstile (anti-robô):** crie um site com os domínios `www.nightcruisegame.com`, `nightcruisegame.com` e `localhost`. Anote a *site key* (pública) e a *secret key*.
4. **Ferramentas, no seu PC, na pasta do jogo:**
   ```
   npm install
   npx supabase login
   npx supabase link --project-ref <ref-do-projeto>
   ```
   O `login` abre o navegador. O `link` pede a senha do banco.
5. **Banco:** `npx supabase db push`. Isso aplica `supabase/migrations/`.
6. **Auth:** defina os segredos só no terminal (não em arquivo) e envie a configuração:
   ```
   $env:RESEND_API_KEY = "..."
   $env:TURNSTILE_SECRET_KEY = "..."
   npx supabase config diff
   npx supabase config push
   ```
   O `config diff` mostra o que vai mudar antes de aplicar.
   Confira no painel (Authentication):
   - Site URL `https://www.nightcruisegame.com`;
   - Redirect URLs com o domínio e `http://localhost:8765/`;
   - confirmação de e-mail ligada;
   - senha mínima 8, com letras e dígitos;
   - "secure password change" ligado;
   - SMTP do Resend;
   - captcha Turnstile;
   - modelos de e-mail em português.

   Se o `config push` não aplicar algo, ajuste manualmente no painel.
7. **Jogo:** preencha `BACKEND` em `js/account.js` (URL, chave anon e site key do Turnstile), suba a versão (`js/version.js` e o `V` no `index.html`) e publique.
8. **Backup:** no GitHub (Settings → Secrets and variables → Actions):
   - crie os secrets `SUPABASE_DB_URL` (Supabase → Connect → *Session pooler*, com a senha) e `BACKUP_PASSPHRASE` (frase longa e aleatória; guarde uma cópia fora do GitHub);
   - crie a variável `BACKUP_ENABLED = true`;
   - rode o workflow "Database backup" uma vez à mão.

### Primeiro administrador (quando existir a área administrativa)
Rode no SQL Editor do Supabase (o papel só pode ser dado por SQL ou pela service key):
```sql
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'
where email = 'seu-email@exemplo.com';
```
A pessoa precisa sair e entrar de novo para o token trazer o papel. As regras do banco já reconhecem o admin (`public.is_admin()`): ele lê os perfis e as estatísticas de todos.

**Área administrativa futura:** um site separado em `admin.nightcruisegame.com` (outro repositório estático) usando o **mesmo** Supabase Auth. Ações de escrita do admin (liberar carro, corrigir estatística) vão como funções no servidor (Edge Functions ou RPC) que conferem `is_admin()`. O sistema de login não muda.

## CORS e domínio
- O Supabase Auth e a Data API aceitam chamadas de qualquer origem. A segurança não depende de CORS, e sim do token (JWT) e do RLS: sem login, nada privado é acessível; com login, só os próprios dados.
- Os links dos e-mails só redirecionam para as URLs da lista do Auth (`site_url` e `additional_redirect_urls`).
- Se forem criadas Edge Functions no futuro, responda CORS só para `https://www.nightcruisegame.com` (e `http://localhost:8765` em desenvolvimento).
- O domínio do jogo não muda. O Supabase usa o próprio endereço (`<ref>.supabase.co`); domínio próprio para a API é um recurso pago e desnecessário agora.

## Desenvolvimento
- **Servidor local do jogo:** `python -m http.server 8765 --directory .`, abrindo `http://localhost:8765/`.
- **Testes do banco (sem Docker, PostgreSQL embutido):** `npm run test:db`.
- **Mudar o banco:** crie um arquivo novo em `supabase/migrations/` (nunca edite um já aplicado), rode `npm run test:db` e depois `npx supabase db push`.
- **Projeto de testes:** o plano gratuito permite 2 projetos. Vale usar um `night-cruise-dev` para testar sem mexer nos jogadores reais; basta trocar o `BACKEND` localmente.

## Restaurar um backup
```
gpg --decrypt nightcruise-db-AAAAMMDD-HHMM.tar.gz.gpg > backup.tar.gz
tar -xzf backup.tar.gz
psql "<URL do banco>" -f backup/roles.sql
psql "<URL do banco>" -f backup/schema.sql
psql "<URL do banco>" -f backup/data.sql
```

## Limitações conhecidas
- **Plano gratuito:** o projeto pausa após 7 dias sem nenhum acesso (reativa no painel). O backup diário faz uma conexão por dia, o que tende a evitar a pausa, mas sem garantia.
- **Antitrapaça:** só plausibilidade (ver acima).
- **Nomes de usuário:** o "nome livre?" responde a qualquer visitante. Nomes são públicos por natureza, então isso não expõe nada privado.
- **Dados pessoais (LGPD):** o jogo passa a guardar e-mails. Antes de abrir o cadastro ao público, publique uma política de privacidade simples (o que é guardado, por quê, e como excluir a conta) e um contato.

## Loja (Pacote Premium, Mercado Pago)

- Catálogo: `products` + `product_cars` (o preço vem do banco, nunca do navegador). Pedidos: `orders` (o jogador só lê os seus).
- `supabase/functions/create-checkout`: confere o token do jogador, abre o pedido (`shop_create_order`) e cria a preferência do Checkout Pro (`external_reference` = id do pedido). Volta ao site com `?pagamento=aprovado|pendente|falhou`.
- `supabase/functions/mp-webhook`: confere a assinatura `x-signature`, busca o pagamento na API do Mercado Pago e aplica (`shop_apply_payment`): aprovado com valor e moeda exatos libera os carros (`car_unlocks.source = 'purchase'`); reembolso/estorno retira. Repetir a mesma notificação não muda nada.
- As funções `shop_*` só podem ser chamadas pelo `service_role` (Edge Functions). Testes: `npm run test:db`.
- Secrets (só no painel do Supabase → Edge Functions → Secrets): `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`. Opcional: `SITE_ORIGINS` (outros domínios do site, separados por vírgula).
- Webhook no Mercado Pago (Suas integrações → Webhooks, evento "Pagamentos"): `https://awynkbzkmyybrjbkqdsb.supabase.co/functions/v1/mp-webhook`
- Os arquivos dos modelos premium ficam públicos no site (o jogo só bloqueia na interface); as estatísticas no servidor recusam carros não liberados.
