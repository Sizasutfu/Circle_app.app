// services/elasticsearchService.js
// Wraps the @elastic/elasticsearch client with search helpers for
// people and posts indices.

const { Client } = require('@elastic/elasticsearch');

const client = new Client({
  node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
  auth: process.env.ELASTICSEARCH_API_KEY
    ? { apiKey: process.env.ELASTICSEARCH_API_KEY }
    : undefined,
});

// Ping on startup so you know immediately if ES is unreachable.
client.ping().catch(() =>
  console.warn('[ES] Elasticsearch is unreachable — search will fall back to MySQL.')
);

// ── People ────────────────────────────────────────────────────────────────────
async function searchPeople(q, { limit = 20, offset = 0 } = {}) {
  const { hits } = await client.search({
    index: 'users',
    from: offset,
    size: limit,
    query: {
      multi_match: {
        query: q,
        fields: ['name^2', 'email'],   // name boosted 2×
        type: 'best_fields',
        fuzziness: 'AUTO',             // handles minor typos
      },
    },
    // Return only the fields the controller already uses
    _source: ['id', 'name', 'email', 'picture', 'postCount', 'followerCount'],
  });

  return hits.hits.map(h => ({ id: h._id, ...h._source }));
}

// ── Posts ─────────────────────────────────────────────────────────────────────
async function searchPosts(q, { limit = 20, offset = 0 } = {}) {
  const { hits } = await client.search({
    index: 'posts',
    from: offset,
    size: limit,
    query: {
      multi_match: {
        query: q,
        fields: ['title^3', 'body', 'tags'],
        type: 'best_fields',
        fuzziness: 'AUTO',
      },
    },
    highlight: {
      fields: { title: {}, body: { fragment_size: 150 } },
    },
  });

  return hits.hits.map(h => ({
    id: h._id,
    ...h._source,
    highlight: h.highlight ?? null,
  }));
}

module.exports = { searchPeople, searchPosts };