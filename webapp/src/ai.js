/**
 * ai.js — Asistente IA para Bus Gijón
 * Proveedores: OpenAI, Deepseek (OpenAI-compatible), Gemini, Anthropic
 */

export const DEFAULT_SYSTEM_PROMPT = `Eres un asistente de transporte EMTUSA (Gijón). REGLAS OBLIGATORIAS:
1. Usa SOLO los datos del CONTEXTO. Nunca inventes paradas, líneas, tiempos ni destinos.
2. Sé CONCISO y directo. Sin frases de introducción ("Basándome en...", "Según los datos...", etc.).
3. Al responder sobre rutas a un destino: menciona ÚNICAMENTE las líneas cuyo trayecto llega a ese destino. Ignora completamente las demás líneas.
4. Si ninguna línea del contexto llega al destino solicitado, responde solo: "No hay líneas cercanas que lleguen a ese destino."
5. Si no hay datos suficientes en el contexto, di: "No tengo datos para responder esto."
6. El usuario está en la calle. Respuestas cortas y útiles.`;

const LS = 'bus_ai_';

export function getAIConfig() {
  return {
    provider:     localStorage.getItem(LS + 'provider')       || '',
    apiKey:       localStorage.getItem(LS + 'api_key')        || '',
    model:        localStorage.getItem(LS + 'model')          || '',
    systemPrompt: localStorage.getItem(LS + 'system_prompt')  || DEFAULT_SYSTEM_PROMPT,
  };
}

export function saveAIConfig(config) {
  localStorage.setItem(LS + 'provider',      config.provider      || '');
  localStorage.setItem(LS + 'api_key',       config.apiKey        || '');
  localStorage.setItem(LS + 'model',         config.model         || '');
  localStorage.setItem(LS + 'system_prompt', config.systemPrompt  || DEFAULT_SYSTEM_PROMPT);
}

export function buildContext(state) {
  return {
    fecha_hora: new Date().toLocaleString('es-ES'),
    ubicacion: state.userLocation
      ? { lat: +state.userLocation.lat.toFixed(5), lng: +state.userLocation.lng.toFixed(5) }
      : null,
    paradas_cercanas: state.nearbyStops.slice(0, 8).map(s => ({
      id: s.idparada,
      nombre: s.descripcion,
      distancia_metros: s.distance ? Math.round(s.distance) : null,
      lineas: [...new Set(state.allArrivals.filter(a => a.stopId == s.idparada).map(a => a.lineId))],
    })),
    llegadas_actuales: state.allArrivals.slice(0, 30).map(a => ({
      linea: a.lineId,
      destino_trayecto: a.direction,
      parada: a.stopName,
      distancia_parada_metros: a.userDistance ? Math.round(a.userDistance) : null,
      minutos: a.busAtStop ? 0 : a.minutes,
      en_parada: a.busAtStop,
    })),
    // Recorridos completos de líneas cercanas (paradas por trayecto)
    recorridos_lineas: Object.entries(state.linesDetailMap || {}).map(([code, d]) => ({
      linea: code,
      nombre: state.linesMap[code]?.name || '',
      trayectos: d.trayectos.map(t => ({
        destino: t.destino,
        paradas: t.paradas,
      })),
    })),
    radio_busqueda_metros: state.radiusMeters,
  };
}

// history = [{role:'user'|'assistant', content: string}, ...]  (máx últimos 10 intercambios)
export async function askAI(question, context, config, history = []) {
  if (!config.provider) throw new Error('Configura el proveedor en Ajustes → IA');
  if (!config.apiKey)   throw new Error('Configura la clave API en Ajustes → IA');

  const systemPrompt = (config.systemPrompt || DEFAULT_SYSTEM_PROMPT)
    + '\n\nCONTEXTO EN TIEMPO REAL:\n' + JSON.stringify(context, null, 2);

  const recentHistory = history.slice(-20); // últimos 10 intercambios (20 mensajes)

  switch (config.provider) {
    case 'openai':
    case 'deepseek':
      return _askOpenAI(question, systemPrompt, config, recentHistory);
    case 'gemini':
      return _askGemini(question, systemPrompt, config, recentHistory);
    case 'anthropic':
      return _askAnthropic(question, systemPrompt, config, recentHistory);
    default:
      throw new Error('Proveedor desconocido: ' + config.provider);
  }
}

async function _askOpenAI(question, systemPrompt, config, history) {
  const base  = config.provider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1';
  const model = config.model || (config.provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini');

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: question },
      ],
      max_tokens: 800,
    }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `Error ${res.status}`); }
  return (await res.json()).choices[0].message.content.trim();
}

async function _askGemini(question, systemPrompt, config, history) {
  const model = config.model || 'gemini-2.0-flash';
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

  const contents = [
    ...history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    { role: 'user', parts: [{ text: question }] },
  ];

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { maxOutputTokens: 800 },
    }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `Error ${res.status}`); }
  return (await res.json()).candidates[0].content.parts[0].text.trim();
}

async function _askAnthropic(question, systemPrompt, config, history) {
  const model = config.model || 'claude-haiku-4-5-20251001';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      system: systemPrompt,
      messages: [...history, { role: 'user', content: question }],
    }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `Error ${res.status}`); }
  return (await res.json()).content[0].text.trim();
}

export function startVoiceRecognition(onResult, onError) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { onError('Reconocimiento de voz no disponible en este navegador'); return null; }

  const r = new SR();
  r.lang = 'es-ES';
  r.continuous = false;
  r.interimResults = false;
  r.onresult = e => onResult(e.results[0][0].transcript);
  r.onerror  = e => onError(e.error === 'not-allowed' ? 'Permiso de micrófono denegado' : `Error de voz: ${e.error}`);
  r.start();
  return r;
}
