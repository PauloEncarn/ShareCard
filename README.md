# Fatura em dia

MVP local em Next.js, React e TypeScript para organizar uma fatura de cartão Itaú por pessoa e acompanhar parcelas futuras.

Backend inicial com Floci: abra `/conta` para cadastro/login, cartões, convites, membros e armazenamento privado de PDFs no S3. O organizador de lançamentos continua usando localStorage e ainda não envia sua importação automaticamente ao backend. Consulte [BACKEND.md](BACKEND.md).

## Executar

Requer Node.js 22.13+ (recomendado 24 LTS) e pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Abra http://127.0.0.1:3000. Use sempre esse mesmo endereço: localStorage é separado por origem. O servidor fica vinculado a 127.0.0.1, sem exposição à rede local.

No ambiente deste projeto também é possível executar `./Iniciar.ps1` no PowerShell. O script procura o Node e o pnpm instalados ou o runtime local do Codex.

## Uso

1. Importe uma fatura digital Itaú (até 15 MB / 30 páginas) ou explore o exemplo fictício.
2. Confira os lançamentos. A confirmação exige que a soma feche com o total do banco. Edite, remova ou adicione linhas na revisão se necessário.
3. Cadastre pessoas na página Pessoas, indique o comprador de cada lançamento e registre observações em Editar compra. O responsável pelo pagamento pode ser diferente do comprador; o ícone de pessoas permite dividir em valores diferentes ou igualmente.
4. Para compras parceladas, escolha se a proporção deve continuar nas próximas parcelas reconhecidas.
5. Consulte a projeção por pessoa, exporte CSV e faça backup JSON. A restauração substitui os dados locais; se houver faturas, o aplicativo exporta os dados anteriores antes.

O portador informado pelo PDF não é automaticamente considerado comprador ou responsável pelo pagamento. Gastos gerais (serviços, juros e encargos) são rateados igualmente entre os compradores indicados e as pessoas com participação positiva nas compras da fatura. Pessoas apenas cadastradas não entram no rateio. Centavos restantes são alternados em ordem estável e o rateio é recalculado quando as compras mudam. A edição permite marcar ou desmarcar um lançamento como gasto geral.

Em `/pessoas`, compare os valores do maior para o menor ou vice-versa. Cada perfil reúne compras, observações, categorias, parcelas futuras, histórico das faturas importadas e um limite opcional por fatura. As três conquistas incentivam definir um limite, organizar todas as compras e manter a fatura organizada dentro do limite. Comparações incompletas são sinalizadas como parciais.

## Privacidade e armazenamento

- O PDF é lido no navegador com PDF.js e um worker servido localmente. Não há upload para API, OCR remoto ou serviços de IA.
- O documento original, CPF, endereço e boleto não são gravados pelo aplicativo.
- Dados extraídos, nomes dos portadores, pessoas e divisões ficam no localStorage deste navegador. Não há criptografia, contas ou sincronização nesta versão. Use apenas um perfil de navegador de confiança.
- Limpar os dados do navegador remove as faturas. Faça backup JSON; o CSV é apenas um relatório.
- O PDF pessoal usado para validar o importador não faz parte do repositório nem da demonstração. Testes com arquivo real são habilitados por variável de ambiente.

## Limites conhecidos

- Importador específico para o layout Itaú digital de duas colunas testado. PDF escaneado, protegido por senha, outros bancos e outros layouts podem ser recusados.
- Datas das compras são preservadas como DD/MM porque o documento não informa o ano de cada lançamento.
- Correspondência entre parcelas usa estabelecimento, dia/mês, portador, número de parcelas e avanço mensal. Casos ambíguos não herdam a divisão automaticamente.
- Quando disponível, a próxima parcela usa o valor exato informado pelo banco. Meses posteriores repetem esse valor como estimativa, podendo divergir por centavos. O horizonte é limitado a 60 meses.
- As previsões não incluem novas compras, recorrências presumidas, juros, taxas futuras ou antecipações. Não equivalem ao total definitivo das próximas faturas.
- Uma importação com o mesmo vencimento e total de uma existente é bloqueada para reduzir duplicidade. Esta versão não distingue contas de cartões diferentes com esses mesmos dados.
- Uma correção no valor de uma compra redistribui proporcionalmente sua atribuição; divergência com o total original fica sinalizada.
- Versão inicial sem controle de pagamentos entre pessoas, autenticação ou processamento em nuvem.

## Validação

```sh
pnpm test
pnpm typecheck
pnpm build
```

Para conferir também o exemplo real em seu computador, configure `ITAU_TEST_PDF` com o caminho do arquivo e execute `pnpm test`. A suíte valida os subtotais, total atual, próximo mês, divisão em centavos, parcelas encerradas e transferência de atribuições.

Validação desta atualização: 15 testes aprovados, incluindo o PDF real, rateio exato de centavos, encargos sem duplicidade, compatibilidade de backup e conquistas. Typecheck e build aprovados. No navegador, foram exercitados edição de comprador e observação, meta pessoal, navegação para perfil, persistência após recarga e detalhamento do rateio. Inspeção visual em desktop e largura de 390 px com dados fictícios em origem separada. A integração WebMCP é opcional e expõe somente `get_statement_summary` se o navegador disponibilizar `document.modelContext`; sua disponibilização foi observada, mas a chamada não foi testada.

## Estrutura e caminho para AWS / Floci

- `lib/itau.ts`: interpretação das linhas e colunas; independente da interface.
- `lib/pdf.ts`: leitura do PDF local com PDF.js.
- `lib/model.ts`: valores em centavos, rateio e projeções.
- `app/organizer.tsx`: organização, importação e edição de compras.
- `app/people-workspace.tsx` e `app/pessoas/`: comparação e perfil por pessoa.
- `app/state-provider.tsx` e `lib/storage.ts`: persistência local e validação de backups.
- `tests/`: validações do importador e das regras de negócio.

O frontend usa armazenamento do navegador. A API opcional em `app/api/backend` usa DynamoDB para contas, vínculos, cartões e metadados e S3 para PDFs, com configuração em `compose.yaml`. O fluxo das telas ainda não está conectado à API. Extração por SQS/Lambda e publicação em AWS não estão implementadas. Consulte [BACKEND.md](BACKEND.md) para execução, validação e limites desta etapa.
