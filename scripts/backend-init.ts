import { CreateBucketCommand, HeadBucketCommand, PutPublicAccessBlockCommand } from '@aws-sdk/client-s3';
import { CreateTableCommand, DescribeTableCommand, DescribeTimeToLiveCommand, waitUntilTableExists, UpdateTimeToLiveCommand } from '@aws-sdk/client-dynamodb';
import { resources } from '../lib/backend/store';

async function main() {
  const { db, s3, table, bucket } = resources();
  try { await s3.send(new HeadBucketCommand({ Bucket: bucket })); }
  catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error;
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  await s3.send(new PutPublicAccessBlockCommand({ Bucket: bucket, PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true } }));
  try { await db.send(new DescribeTableCommand({ TableName: table })); }
  catch (error) {
    if (!(error instanceof Error) || error.name !== 'ResourceNotFoundException') throw error;
    await db.send(new CreateTableCommand({ TableName: table, BillingMode: 'PAY_PER_REQUEST', KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }], AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }] }));
    await waitUntilTableExists({ client: db, maxWaitTime: 30 }, { TableName: table });
  }
  const ttl = await db.send(new DescribeTimeToLiveCommand({ TableName: table }));
  if (!['ENABLED', 'ENABLING'].includes(ttl.TimeToLiveDescription?.TimeToLiveStatus || '')) {
    await db.send(new UpdateTimeToLiveCommand({ TableName: table, TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true } }));
  }
  console.log(`Floci inicializado: bucket ${bucket}, tabela ${table}.`);
}
main().catch(error => { console.error('Não foi possível inicializar o Floci:', error instanceof Error ? error.message : 'erro desconhecido'); process.exitCode = 1; });
