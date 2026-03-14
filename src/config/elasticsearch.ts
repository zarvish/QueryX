import { Client } from '@elastic/elasticsearch';
import { config } from './index';
import { logger } from '../utils/logger';

let esClient: Client | null = null;

/**
 * Creates and returns a singleton Elasticsearch client instance.
 */
export function createElasticsearchClient(): Client {
  if (esClient) {
    return esClient;
  }

  esClient = new Client({
    node: config.ELASTICSEARCH_URL,
    auth: {
      username: config.ELASTICSEARCH_USERNAME,
      password: config.ELASTICSEARCH_PASSWORD,
    },
    requestTimeout: 10000,
    maxRetries: 3,
    sniffOnStart: false,
  });

  logger.info({ node: config.ELASTICSEARCH_URL }, 'Elasticsearch client created');

  return esClient;
}

export function getElasticsearchClient(): Client {
  if (!esClient) {
    throw new Error('Elasticsearch client not initialized');
  }
  return esClient;
}

export async function closeElasticsearchClient(): Promise<void> {
  if (esClient) {
    await esClient.close();
    esClient = null;
    logger.info('Elasticsearch client closed');
  }
}
