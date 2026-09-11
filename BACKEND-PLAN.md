# Persistência compartilhada

O PDF é o documento original: fica no bucket privado do master. A leitura feita no
cliente vira uma fatura estruturada no DynamoDB, no mesmo fluxo de importação.
`localStorage` deixa de ser a fonte de dados; poderá manter somente preferências
locais e um rascunho de importação ainda não confirmado.

## Registros no DynamoDB

Todos os registros do grupo usam `MASTER#{masterId}` como partição.

| `sk` | Conteúdo |
| --- | --- |
| `PERSON#{personId}` | Pessoa, limite, cor e `accountId` opcional |
| `CARD#{cardId}` | Cartão e dia de vencimento |
| `STATEMENT#{statementId}` | Fatura: cartão, vencimento, total, PDF e versão |
| `TRANSACTION#{statementId}#{transactionId}` | Compra, categoria, comprador, rateio, observação e versão |
| `GOAL#{personId}#{cardId}` | Meta por pessoa e cartão |

Uma `Pessoa` pode ter `accountId` vazio. Isso mantém crianças e participantes
ocasionais no rateio. No registro de um convite aceito, o backend procura uma
pessoa sem conta com o mesmo e-mail convidado ou permite que o master faça a
vinculação explícita.

## Concorrência e permissões

Cada fatura, pessoa e lançamento possui `version`. Atualizações exigem a versão
recebida pela tela em uma escrita condicional do DynamoDB. Se alguém já salvou uma
alteração, a API responde `409`; a tela recarrega o registro e mostra o conflito,
em vez de sobrescrever silenciosamente.

| Ação | Master | Comprador |
| --- | --- | --- |
| Importar, corrigir e excluir PDFs/faturas | Sim | Não |
| Gerenciar cartões e pessoas | Sim | Não |
| Atribuir compra, rateio, categoria e metas | Sim | Não |
| Ver PDF e faturas do próprio grupo | Sim | Sim |
| Editar observação da própria compra | Não aplicável | Sim |

O comprador não altera atribuições ou rateios nesta primeira regra. Isso preserva o
fechamento do master e ainda permite que ele registre contexto na compra que lhe foi
atribuída.

## Ciclos

Uma fatura é identificada por `cardId + dueDate`, nunca apenas por mês. Assim, um
cartão que vence no dia 06 e outro no dia 20 mantêm históricos e projeções
independentes. As projeções usam somente os lançamentos parcelados da fatura do
ciclo selecionado.
