import { Client, estypes } from '@elastic/elasticsearch';
import Redis from 'ioredis';
import { buildSearchCacheKey, buildTenantIndexName, elapsedMs } from '../../utils/helpers';
import { logger } from '../../utils/logger';
import { SearchError } from '../../utils/errors';
import { SearchResult, SearchHit } from '../../types';
import { SearchQuery } from './search.schema';
import { config } from '../../config';
import { parseCommaSeparated } from '../../utils/helpers';

/**
 * Service layer for full-text document search.
 * Uses Elasticsearch with caching via Redis.
 * All queries are strictly tenant-scoped.
 */
export class SearchService {
  constructor(
    private readonly esClient: Client,
    private readonly redis: Redis,
  ) {}

  /**
   * Builds the Elasticsearch multi_match query for title + content search.
   */
  private buildTextQuery(
    q: string,
    fuzzy: boolean,
  ): estypes.QueryDslQueryContainer {
    if (fuzzy) {
      return {
        multi_match: {
          query: q,
          fields: ['title^3', 'content^1'],
          type: 'best_fields',
          fuzziness: 'AUTO',
          prefix_length: 2,
        },
      };
    }

    return {
      multi_match: {
        query: q,
        fields: ['title^3', 'content^1'],
        type: 'best_fields',
      },
    };
  }

  /**
   * Builds Elasticsearch filter clauses from search parameters.
   */
  private buildFilters(
    tenantId: string,
    opts: {
      tags?: string;
      author?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ): estypes.QueryDslQueryContainer[] {
    const filters: estypes.QueryDslQueryContainer[] = [
      { term: { tenant_id: tenantId } },
      { term: { is_deleted: false } },
    ];

    if (opts.tags) {
      const tagList = parseCommaSeparated(opts.tags);
      if (tagList.length > 0) {
        filters.push({ terms: { tags: tagList } });
      }
    }

    if (opts.author) {
      filters.push({ term: { author: opts.author } });
    }

    if (opts.dateFrom || opts.dateTo) {
      const rangeFilter: estypes.QueryDslRangeQuery = {};
      if (opts.dateFrom) rangeFilter['gte'] = opts.dateFrom;
      if (opts.dateTo) rangeFilter['lte'] = opts.dateTo;
      filters.push({ range: { created_at: rangeFilter } });
    }

    return filters;
  }

  /**
   * Performs a full-text search with optional fuzzy matching, filters, and facets.
   * Results are cached by tenantId + query hash for 60 seconds.
   * Tenant isolation is enforced at the query level with a mandatory tenant_id filter.
   *
   * @param tenantId - ID of the tenant making the search request
   * @param query - Validated search query parameters
   */
  async search(tenantId: string, query: SearchQuery): Promise<SearchResult> {
    const cacheKey = buildSearchCacheKey(tenantId, JSON.stringify(query));

    // Cache-aside: check Redis first
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      logger.debug({ tenantId, q: query.q }, 'Search cache HIT');
      return JSON.parse(cached) as SearchResult;
    }

    logger.debug({ tenantId, q: query.q }, 'Search cache MISS');

    const indexName = buildTenantIndexName(tenantId);
    const from = (query.page - 1) * query.limit;
    const start = process.hrtime.bigint();

    try {
      const esResponse = await this.esClient.search<Record<string, unknown>>({
        index: indexName,
        ignore_unavailable: true,
        body: {
          from,
          size: query.limit,
          query: {
            bool: {
              must: [this.buildTextQuery(query.q, query.fuzzy ?? false)],
              filter: this.buildFilters(tenantId, {
                tags: query.tags,
                author: query.author,
                dateFrom: query.dateFrom,
                dateTo: query.dateTo,
              }),
            },
          },
          highlight: {
            fields: {
              title: { fragment_size: 100, number_of_fragments: 1 },
              content: { fragment_size: 200, number_of_fragments: 2 },
            },
            pre_tags: ['<em>'],
            post_tags: ['</em>'],
          },
          aggs: {
            tags: {
              terms: { field: 'tags', size: 20 },
            },
            authors: {
              terms: { field: 'author', size: 20 },
            },
          },
        },
      });

      const took = Math.round(elapsedMs(start));

      logger.info(
        { tenantId, q: query.q, took, totalHits: esResponse.hits.total },
        'Elasticsearch search completed',
      );

      const totalHits =
        typeof esResponse.hits.total === 'number'
          ? esResponse.hits.total
          : (esResponse.hits.total?.value ?? 0);

      const hits: SearchHit[] = esResponse.hits.hits.map((hit) => {
        const source = hit._source as Record<string, unknown>;
        return {
          id: String(source['doc_id'] ?? hit._id),
          score: hit._score ?? 0,
          title: String(source['title'] ?? ''),
          author: source['author'] ? String(source['author']) : undefined,
          tags: Array.isArray(source['tags']) ? (source['tags'] as string[]) : [],
          createdAt: String(source['created_at'] ?? ''),
          updatedAt: String(source['updated_at'] ?? ''),
          highlights: hit.highlight
            ? {
                title: hit.highlight['title'] as string[] | undefined,
                content: hit.highlight['content'] as string[] | undefined,
              }
            : undefined,
        };
      });

      // Extract facets
      const tagsAgg = (esResponse.aggregations?.['tags'] as { buckets?: Array<{ key: string; doc_count: number }> })?.buckets ?? [];
      const authorsAgg = (esResponse.aggregations?.['authors'] as { buckets?: Array<{ key: string; doc_count: number }> })?.buckets ?? [];

      const result: SearchResult = {
        hits,
        total: totalHits,
        page: query.page,
        limit: query.limit,
        took,
        facets: {
          tags: tagsAgg.map((b) => ({ key: b.key, count: b.doc_count })),
          authors: authorsAgg.map((b) => ({ key: b.key, count: b.doc_count })),
        },
      };

      // Cache the result
      await this.redis
        .setex(cacheKey, config.CACHE_SEARCH_TTL, JSON.stringify(result))
        .catch((err) => logger.warn({ err }, 'Failed to cache search result'));

      return result;
    } catch (err) {
      const error = err as Error & { meta?: { statusCode?: number } };

      // If index doesn't exist, return empty results
      if (
        error.message?.includes('index_not_found_exception') ||
        error.meta?.statusCode === 404
      ) {
        logger.debug({ tenantId, indexName }, 'Index not found, returning empty results');
        return {
          hits: [],
          total: 0,
          page: query.page,
          limit: query.limit,
          took: Math.round(elapsedMs(start)),
          facets: { tags: [], authors: [] },
        };
      }

      logger.error({ err, tenantId, q: query.q }, 'Elasticsearch search failed');
      throw new SearchError(`Search failed: ${error.message}`);
    }
  }
}
