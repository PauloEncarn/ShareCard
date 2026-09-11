# Backend local com Floci

Primeira API de contas e documentos, acessível pela tela `/conta`. Cadastro/login, cartões, convites, membros, upload e biblioteca de PDFs já chamam esta API. O organizador de lançamentos continua usando localStorage: confirmar um PDF nessa tela ainda não o envia automaticamente ao S3, e dados existentes não são migrados.

## Modelo

- Master: dono do espaço e dos cartões; cadastra cartões, convida compradores, importa PDFs e revoga compradores.
- Comprador: conta vinculada a exatamente um master por convite individual de uso único, válido por 48 horas. Pode listar cartões e faturas e baixar os PDFs completos desse master, conforme a decisão do produto. Não pode administrar ou importar.
- Cartão: nome e dia de vencimento padrão. Não armazenamos número completo, CVV ou credenciais bancárias.
- Fatura: cartão + data real de vencimento, identificador e metadados. Um documento por cartão/data; mesmo total em cartões diferentes não é duplicidade. Uma substituição de PDF ainda não tem fluxo implementado.

Um bucket privado atende vários masters. Cada espaço tem um prefixo, por exemplo:

```text
masters/{masterId}/cards/{cardId}/due/2026-09-06/{documentId}.pdf
masters/{masterId}/cards/{outroCardId}/due/2026-09-20/{documentId}.pdf
```

O backend determina o master pela sessão e consulta somente sua partição no DynamoDB. O prefixo organiza arquivos; não concede autorização sozinho. Downloads passam pela API, que verifica a conta em cada chamada, inclusive após revogação. Não há URLs públicas nem credenciais AWS entregues ao comprador. AWS documenta a organização por [prefixos](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-prefixes.html) e os [padrões de buckets compartilhados](https://docs.aws.amazon.com/AmazonS3/latest/userguide/common-bucket-patterns.html).

## Executar no Windows

Requer Node/pnpm já utilizados e Docker Desktop funcionando com containers Linux. Floci é um emulador para desenvolvimento; a disponibilização pública usará AWS real.

Na pasta `fatura`:

```powershell
Copy-Item .env.example .env.local
docker compose up -d
pnpm backend:init
pnpm dev
```

Se `.env.local` já existir, mescle as variáveis em vez de sobrescrever. Se um servidor estiver rodando, reinicie-o para carregar o ambiente. `backend:init` cria bucket privado, tabela com chaves `pk`/`sk` e TTL de sessões/convites. O Compose persiste o emulador em volume; `docker compose down` preserva esse volume. Não use a opção de apagar volumes se quiser manter os dados.

## API

Base: `http://127.0.0.1:3000/api/backend`. Respostas não são cacheadas. Operações protegidas exigem `Authorization: Bearer <token>`.

| Método / caminho | Dados | Acesso |
| --- | --- | --- |
| POST /register | `{name,email,password}` | Cria master |
| POST /register | `{name,email,password,inviteToken}` | Cria comprador pelo convite |
| POST /login | `{email,password}` | Retorna token de sessão de 8 horas |
| POST /logout | `{}` | Invalida sessão |
| GET /me | — | Conta atual |
| POST /invites | `{email}` | Master; retorna token, sem enviar mensagem |
| GET /members | — | Master |
| POST /members/revoke | `{userId}` | Master; desativa comprador |
| POST /cards | `{name,dueDay:6}` | Master |
| GET /cards | — | Master e compradores |
| POST /documents?cardId=ID&dueDate=2026-09-06 | Corpo binário PDF, até 15 MB | Master |
| GET /documents | — | Lista ordenada por vencimento decrescente |
| GET /documents/ID | — | PDF completo do próprio grupo |

Senhas de 12 a 128 caracteres recebem scrypt com salt aleatório. Tokens de sessão e convite são armazenados apenas pelo hash. No navegador, a tela usa cookie HttpOnly, SameSite Strict, com duração de oito horas; o endpoint também retorna o token para testes e clientes não baseados em navegador enquanto o backend é somente local. A validade é conferida na aplicação sem depender do prazo da limpeza TTL. Criação de conta e consumo de convite são transacionais. O download não aceita bucket, chave S3 ou master arbitrário do cliente.

## Verificação

```powershell
pnpm test
pnpm typecheck
pnpm build
# Com o servidor e Floci inicializado:
pnpm backend:smoke
```

O smoke cria apenas dados fictícios: dois masters, comprador vinculado, cartões 06/20 e documentos sintéticos. Verifica upload, duplicidade, download completo, isolamento entre masters, revogação e logout. Os dados ficam no volume local. O teste de transporte não substitui testes do interpretador de PDF.

Nesta entrega: 22 testes aprovados, 1 teste opcional do PDF pessoal não executado, typecheck e build aprovados. Docker Desktop 4.90.0, Docker Engine 29.7.2 e Floci foram iniciados com sucesso. O smoke de integração foi aprovado com dois masters isolados, comprador vinculado, cartões com vencimento 06/20, upload e download de PDFs, bloqueio de duplicidade e revogação de acesso.

## Antes de disponibilizar ao público

Esta API está habilitada apenas em modo Floci/local e não é uma entrega pronta para publicação. Próximas etapas: unificar o upload do organizador com o S3, vincular contas de compradores às pessoas de rateio existentes, persistir compras/notas/divisões, adotar autenticação de produção (por exemplo Cognito), confirmação de e-mail, recuperação de senha, limites de requisições e HTTPS. Configurar AWS real com IAM mínimo, proteção do bucket, logs de acesso e política de retenção/exclusão.

O upload atual valida limite e assinatura inicial do PDF; não interpreta o documento nem atesta seu conteúdo. A data real é recebida explicitamente e pode divergir do dia padrão por ajustes de calendário. Upload S3 e metadados DynamoDB não formam uma transação única: conflitos conhecidos removem o arquivo novo; falhas incertas podem deixar objetos órfãos e precisam de reconciliação operacional antes da produção. A imagem Floci usa `latest` nesta etapa de desenvolvimento; fixe versão/digest após validar o smoke para obter CI reproduzível.
