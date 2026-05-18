// ============================================================
// Cloudflare Worker — Notion API CORS Proxy
// Deploy at: https://dash.cloudflare.com → Workers → Create
// Set secret: wrangler secret put NOTION_API_KEY
// ============================================================

export default {
  async fetch(request, env) {
    // Allow CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);

    // Route: POST /notion/query?database_id=xxx
    if (url.pathname === '/notion/query' && request.method === 'POST') {
      const databaseId = url.searchParams.get('database_id');
      if (!databaseId) {
        return jsonResponse({ error: 'Missing database_id' }, 400);
      }

      const body = await request.text();

      const notionRes = await fetch(
        `https://api.notion.com/v1/databases/${databaseId}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: body || '{}',
        }
      );

      const data = await notionRes.json();
      return jsonResponse(data, notionRes.status);
    }

    // Route: GET /notion/page?page_id=xxx
    if (url.pathname === '/notion/page' && request.method === 'GET') {
      const pageId = url.searchParams.get('page_id');
      if (!pageId) {
        return jsonResponse({ error: 'Missing page_id' }, 400);
      }

      const notionRes = await fetch(
        `https://api.notion.com/v1/blocks/${pageId}/children`,
        {
          headers: {
            'Authorization': `Bearer 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`,
            'Notion-Version': '2022-06-28',
          },
        }
      );

      const data = await notionRes.json();
      return jsonResponse(data, notionRes.status);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}
