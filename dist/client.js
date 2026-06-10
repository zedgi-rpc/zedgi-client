/** Web-standard UUID (works in Node 18+, Cloudflare Workers, Deno, browsers). */
const randomId = () => (globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
export const callZedgi = async (options, service, method, payload = {}) => {
    const url = new URL('/rpc', options.url);
    const body = JSON.stringify({ requestId: randomId(), service, method, payload });
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), options.timeout ?? 10_000);
    let response;
    try {
        response = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-zedgi-key': options.key,
            },
            body,
            signal: controller.signal,
        });
    }
    finally {
        clearTimeout(timerId);
    }
    const parsed = await response.json();
    if (!parsed.ok) {
        const err = new Error(parsed.error?.message ?? `Zedgi call failed (${response.status})`);
        err.code = parsed.error?.code;
        err.statusCode = response.status;
        err.details = parsed.error?.details;
        throw err;
    }
    return parsed.result;
};
