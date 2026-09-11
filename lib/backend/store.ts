import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, TransactWriteCommand, type TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { ApiError } from './domain';

// Deliberately local-only until production identity and deployment are configured.
export function configuration() {
  if (process.env.BACKEND_MODE !== 'floci') throw new ApiError(503, 'Backend local não configurado. Consulte BACKEND.md.');
  const endpoint = new URL(process.env.AWS_ENDPOINT_URL || 'http://127.0.0.1:4566');
  if (!['127.0.0.1', 'localhost', 'floci'].includes(endpoint.hostname) || endpoint.protocol !== 'http:') throw new ApiError(503, 'Endpoint Floci local inválido.');
  return { endpoint: endpoint.origin, region: process.env.AWS_REGION || 'us-east-1', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } };
}
export function resources() {
  const config = configuration();
  return {
    db: DynamoDBDocumentClient.from(new DynamoDBClient(config), { marshallOptions: { removeUndefinedValues: true } }),
    s3: new S3Client({ ...config, forcePathStyle: true }),
    table: process.env.FATURA_TABLE || 'fatura-local', bucket: process.env.FATURA_BUCKET || 'fatura-local-documents',
  };
}
export class Store {
  readonly aws = resources();
  async get<T>(pk: string, sk = 'PROFILE'): Promise<T | undefined> {
    const result = await this.aws.db.send(new GetCommand({ TableName: this.aws.table, Key: { pk, sk }, ConsistentRead: true }));
    return result.Item as T | undefined;
  }
  async put(pk: string, sk: string, data: object) {
    await this.aws.db.send(new PutCommand({ TableName: this.aws.table, Item: { ...data, pk, sk } }));
  }
  async remove(pk: string, sk = 'PROFILE') { await this.aws.db.send(new DeleteCommand({ TableName: this.aws.table, Key: { pk, sk } })); }
  async replaceVersioned(pk: string, sk: string, data: object, version: number) {
    try { await this.aws.db.send(new PutCommand({ TableName: this.aws.table, Item: { ...data, pk, sk }, ConditionExpression: 'version = :version', ExpressionAttributeValues: { ':version': version } })); }
    catch (error) { if (error instanceof Error && error.name === 'ConditionalCheckFailedException') throw new ApiError(409, 'Este registro foi alterado por outra pessoa. Atualize a tela e tente novamente.'); throw error; }
  }
  async list<T>(pk: string, prefix: string): Promise<T[]> {
    const items: T[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const result = await this.aws.db.send(new QueryCommand({ TableName: this.aws.table, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': pk, ':prefix': prefix }, ExclusiveStartKey: cursor, ConsistentRead: true }));
      items.push(...(result.Items || []) as T[]); cursor = result.LastEvaluatedKey;
    } while (cursor);
    return items;
  }
  async transaction(items: NonNullable<TransactWriteCommandInput['TransactItems']>) {
    try { await this.aws.db.send(new TransactWriteCommand({ TransactItems: items })); }
    catch (error) {
      if (error instanceof Error && error.name === 'TransactionCanceledException') throw new ApiError(409, 'Registro já existente ou convite indisponível.');
      throw error;
    }
  }
  unique(pk: string, sk: string, data: object) {
    return { Put: { TableName: this.aws.table, Item: { ...data, pk, sk }, ConditionExpression: 'attribute_not_exists(pk)' } };
  }
}
