/**
 * Cloudflare Worker — Tuya Grow Dashboard
 * 
 * COMO FAZER O DEPLOY:
 * 1. Acesse https://workers.cloudflare.com e crie uma conta gratuita
 * 2. Clique em "Create Worker"
 * 3. Cole este código no editor e clique em "Deploy"
 * 4. Vá em Settings → Variables e adicione as variáveis de ambiente:
 *    - TUYA_CLIENT_ID     → seu Access ID
 *    - TUYA_CLIENT_SECRET → seu Access Secret
 *    - TUYA_REGION        → us | eu | cn (ex: "us" para América)
 * 5. Anote a URL do seu Worker (ex: https://grow-dash.SEU-USUARIO.workers.dev)
 */

const REGION_HOSTS = {
  us: "https://openapi.tuyaus.com",
  eu: "https://openapi.tuyaeu.com",
  cn: "https://openapi.tuyacn.com",
  in: "https://openapi.tuyain.com",
};

async function hmacSha256(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getToken(clientId, clientSecret, host) {
  const ts = Date.now().toString();
  const stringToSign = clientId + ts + "GET\n\n\n\n/v1.0/token?grant_type=1";
  const sign = (await hmacSha256(clientSecret, stringToSign)).toUpperCase();

  const res = await fetch(`${host}/v1.0/token?grant_type=1`, {
    headers: {
      "client_id": clientId,
      "sign": sign,
      "t": ts,
      "sign_method": "HMAC-SHA256",
    }
  });
  const data = await res.json();
  if (!data.success) throw new Error("Token error: " + data.msg);
  return data.result.access_token;
}

async function getDeviceStatus(clientId, clientSecret, host, token, deviceId) {
  const ts = Date.now().toString();
  const path = `/v1.0/devices/${deviceId}/status`;
  const stringToSign = clientId + token + ts + "GET\n\n\n\n" + path;
  const sign = (await hmacSha256(clientSecret, stringToSign)).toUpperCase();

  const res = await fetch(`${host}${path}`, {
    headers: {
      "client_id": clientId,
      "access_token": token,
      "sign": sign,
      "t": ts,
      "sign_method": "HMAC-SHA256",
    }
  });
  return res.json();
}

export default {
  async fetch(request, env) {
    // CORS para o painel HTML poder acessar
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Rota de status: GET /status?devices=ID1,ID2,ID3
    if (url.pathname === "/status") {
      try {
        const { TUYA_CLIENT_ID, TUYA_CLIENT_SECRET, TUYA_REGION } = env;
        if (!TUYA_CLIENT_ID || !TUYA_CLIENT_SECRET) {
          return new Response(
            JSON.stringify({ error: "Variáveis de ambiente não configuradas." }),
            { status: 500, headers: corsHeaders }
          );
        }

        const host = REGION_HOSTS[TUYA_REGION || "us"];
        const deviceIds = (url.searchParams.get("devices") || "").split(",").filter(Boolean);

        if (deviceIds.length === 0) {
          return new Response(
            JSON.stringify({ error: "Parâmetro 'devices' não informado." }),
            { status: 400, headers: corsHeaders }
          );
        }

        const token = await getToken(TUYA_CLIENT_ID, TUYA_CLIENT_SECRET, host);

        const results = {};
        for (const id of deviceIds) {
          const data = await getDeviceStatus(TUYA_CLIENT_ID, TUYA_CLIENT_SECRET, host, token, id.trim());
          results[id.trim()] = data.success ? data.result : { error: data.msg };
        }

        return new Response(JSON.stringify({ success: true, devices: results }), {
          headers: corsHeaders,
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: corsHeaders,
        });
      }
    }

    // Rota raiz — health check
    if (url.pathname === "/") {
      return new Response(JSON.stringify({ status: "Grow Worker online!" }), {
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ error: "Rota não encontrada" }), {
      status: 404, headers: corsHeaders,
    });
  }
};
