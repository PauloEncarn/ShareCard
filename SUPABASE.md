# Supabase: primeira configuraÃ§Ã£o

1. Crie um projeto gratuito no [Supabase Dashboard](https://supabase.com/dashboard).
2. No **SQL Editor**, execute `supabase/migrations/0001_sharecard.sql`.
3. Em **Authentication > Providers**, habilite e-mail/senha.
4. Em **Project Settings > API**, copie a URL, a chave `publishable` e a `service_role` para `.env.local` com os nomes de `.env.example`.
5. Nunca publique `SUPABASE_SERVICE_ROLE_KEY`, nem a renomeie para `NEXT_PUBLIC_*`.

O schema cria os buckets privados `statements` para PDFs e `avatars` para fotos. A futura API no servidor emitirÃ¡ URLs assinadas somente depois de validar se o usuÃ¡rio pertence ao mesmo master.

## Identidade

As rotas `POST /api/supabase/auth/register`, `POST /api/supabase/auth/login`, `GET /api/supabase/auth/me` e `DELETE /api/supabase/auth/logout` jÃ¡ criam e validam masters no Supabase Auth e em `profiles`. Elas ainda nÃ£o substituem a tela `/conta`, porque os fluxos de cartÃµes, compradores, PDFs e organizaÃ§Ã£o ainda usam Floci. A troca da tela ocorrerÃ¡ quando essas rotas forem migradas como um conjunto.

## MigraÃ§Ã£o gradual

O modo `floci` segue ativo para manter o ambiente local. A prÃ³xima etapa troca as rotas de contas, convites, PDFs e persistÃªncia por Supabase Auth, Postgres, Storage e Realtime. SÃ³ depois de validada essa etapa removeremos DynamoDB/S3/Floci do fluxo da aplicaÃ§Ã£o.
