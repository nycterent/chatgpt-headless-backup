export async function getToken(page) {
  const result = await page.evaluate(async () => {
    const fetchWithTimeout = async (url, options = {}, ms = 30000) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ms);
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    };

    const sessionResponse = await fetchWithTimeout('/api/auth/session', {
      credentials: 'include',
    }, 30000);
    const sessionText = await sessionResponse.text();
    let session = null;
    try { session = JSON.parse(sessionText); } catch { session = null; }

    const token = session?.accessToken;
    if (!token) {
      const looksLikeChallenge = /just a moment|cf-browser-verification|cloudflare|challenge-platform|attention required/i.test(sessionText);
      return { error: looksLikeChallenge ? 'cloudflare' : 'no-token' };
    }

    return { token };
  });

  if (result?.error === 'cloudflare') {
    throw new Error('Blocked by a Cloudflare challenge — run `npm run login`.');
  }

  if (result?.error === 'no-token') {
    throw new Error('Not logged in — run `npm run login`');
  }

  return result.token;
}

export async function listConversationIds(page, token) {
  const result = await page.evaluate(async (tokenValue) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const fetchWithTimeout = async (url, options = {}, ms = 30000) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ms);
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    };

    const headers = {
      authorization: `Bearer ${tokenValue}`,
    };

    const backoffMs = (attempt, response) => {
      if (response && typeof response.headers?.get === 'function') {
        const retryAfter = Number(response.headers.get('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
          return Math.min(retryAfter * 1000, 60000);
        }
      }
      const exp = Math.min(2000 * 2 ** (attempt - 1), 30000);
      return exp + Math.floor(Math.random() * 1000);
    };

    const fetchListPage = async (offset, limit, maxAttempts = 5) => {
      let lastStatus = 'timeout';

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let response;
        try {
          response = await fetchWithTimeout(`/backend-api/conversations?offset=${offset}&limit=${limit}`, {
            headers,
          }, 30000);
        } catch (error) {
          if (attempt < maxAttempts) {
            await sleep(backoffMs(attempt, response));
            continue;
          }

          return { error: 'failed-list-timeout' };
        }

        if (response.ok) {
          return response.json();
        }

        if (response.status === 401) {
          return { error: 'unauthorized' };
        }

        lastStatus = response.status;
        const shouldRetry = response.status === 429 || response.status >= 500;
        if (shouldRetry && attempt < maxAttempts) {
          await sleep(backoffMs(attempt, response));
          continue;
        }

        return { error: `failed-list-${response.status}` };
      }

      return { error: `failed-list-${lastStatus}` };
    };

    const items = [];
    const limit = 20;
    let offset = 0;
    let total = Infinity;

    while (offset < total) {
      const pageJson = await fetchListPage(offset, limit);
      if (pageJson?.error) {
        return pageJson;
      }

      const pageItems = Array.isArray(pageJson.items) ? pageJson.items : [];
      items.push(...pageItems);
      total = Number.isFinite(pageJson.total) ? pageJson.total : items.length;
      offset += limit;

      if (offset < total) {
        await sleep(800);
      }
    }

    return {
      ids: items.map((item) => ({
        id: item.id,
        update_time: item.update_time,
      })),
      total,
    };
  }, token);

  if (result?.error === 'unauthorized') {
    throw new Error('Session unauthorized — run `npm run login`');
  }

  if (result?.error) {
    throw new Error(`List fetch failed — ${result.error}`);
  }

  return result;
}

export async function fetchConversationRaw(page, token, id) {
  return page.evaluate(async ({ token: tokenValue, id: conversationId }) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const fetchWithTimeout = async (url, options = {}, ms = 30000) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ms);
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    };

    const headers = {
      authorization: `Bearer ${tokenValue}`,
    };
    const backoffMs = (attempt, response) => {
      if (response && typeof response.headers?.get === 'function') {
        const retryAfter = Number(response.headers.get('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
          return Math.min(retryAfter * 1000, 60000);
        }
      }
      const exp = Math.min(2000 * 2 ** (attempt - 1), 30000);
      return exp + Math.floor(Math.random() * 1000);
    };
    const maxAttempts = 5;
    let lastStatus = 'timeout';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response;
      try {
        response = await fetchWithTimeout(`/backend-api/conversation/${conversationId}`, {
          headers,
        }, 30000);
      } catch (error) {
        if (attempt < maxAttempts) {
          await sleep(backoffMs(attempt, response));
          continue;
        }

        return { error: 'failed-timeout' };
      }

      if (response.ok) {
        return { raw: await response.json() };
      }

      if (response.status === 401) {
        return { unauthorized: true };
      }

      lastStatus = response.status;
      const shouldRetry = response.status === 429 || response.status >= 500;
      if (shouldRetry && attempt < maxAttempts) {
        await sleep(backoffMs(attempt, response));
        continue;
      }

      return { error: `failed-${response.status}` };
    }

    return { error: `failed-${lastStatus}` };
  }, { token, id });
}
