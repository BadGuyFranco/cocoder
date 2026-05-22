const SPECIALIZED_PERSONAS = new Set(['phil', 'quinn', 'talia', 'ian']);

const PERSONA_PATTERNS = {
  phil: /\bPhil\b/i,
  quinn: /\bQuinn\b/i,
  talia: /\bTalia\b/i,
  ian: /\bIan\b/i
};

const REQUIRED_CONTEXT_PATTERNS = [
  /\bnext\b/i,
  /\bdispatch(?:es|ed)?\b/i,
  /\bowner\b/i,
  /\bexecutor(?:s)?\b/i,
  /\brequired\b/i,
  /\bneeds?\b/i,
  /\bmust\b/i,
  /\bverification\b/i,
  /\bQA\b/,
  /\bpacket\b/i,
  /\blane\b/i,
  /\broute\b/i,
  /\bdrives?\b/i
];

const PACKET_OR_NOT_EXECUTED_PATTERNS = [
  /\bpacket(?:ized| filed)?\b/i,
  /\bnot executed\b/i,
  /\bnot live-dispatched\b/i,
  /\bdeferred\b/i,
  /\bneeds? .*\blane\b/i
];

const CURRENT_ACTION_PATTERNS = [
  /\bNext Action\b/i,
  /\bRecommended next atom\b/i,
  /\bNext session (?:should|must)\b/i,
  /\bnext atom\b/i,
  /\bcurrent atom\b/i,
  /\batom to land\b/i,
  /\bdispatch(?:es|ed)?\b/i,
  /\bdispatch-ready\b/i,
  /\brequired persona\b/i,
  /\bneeds? .*\blane\b/i
];

const NON_CURRENT_CONTEXT_PATTERNS = [
  /\bfounder-gated\b/i,
  /\bgated separately\b/i,
  /\bpre-authorized\b/i,
  /\bresidual\b/i,
  /\bremaining\b/i,
  /\bafter\b/i,
  /\bonce\b/i,
  /\bwhen\b/i,
  /\blater\b/i,
  /\bfuture\b/i,
  /\bclosed\b/i,
  /\bclosures?\b/i,
  /\bdone\b/i,
  /\barchived\b/i,
  /\bhistorical\b/i,
  /\bnot actionable\b/i
];

export function auditPersonaRouteFit({ selectedPriority, recentSessionContext, route, lanes = [] } = {}) {
  const availablePersonas = [...new Set((lanes || [])
    .map((lane) => String(lane?.persona || '').toLowerCase())
    .filter(Boolean))];
  const evidence = [];
  const required = new Set();
  const packetized = new Set();
  const sourceText = [
    selectedPriority?.lastUpdated,
    selectedPriority?.status,
    selectedPriority?.excerpt,
    recentSessionContext?.excerpt
  ].filter(Boolean).join('\n');

  for (const rawLine of String(sourceText || '').split(/\r?\n/)) {
    for (const line of currentActionSegments(rawLine)) {
      for (const persona of SPECIALIZED_PERSONAS) {
        if (!PERSONA_PATTERNS[persona].test(line)) continue;
        if (isRequiredPersonaLine(line)) {
          required.add(persona);
          evidence.push({ persona, source: summarizeLine(line), reason: 'required-persona-context' });
        }
        if (isPacketOnlyPersonaLine(line)) {
          packetized.add(persona);
          evidence.push({ persona, source: summarizeLine(line), reason: 'packetized-or-not-executed-context' });
        }
      }
    }
  }

  const explicitCurrentPersonas = currentActionExplicitPersonas(sourceText);
  for (const persona of explicitCurrentPersonas) {
    if (!SPECIALIZED_PERSONAS.has(persona)) continue;
    if (!required.has(persona)) {
      required.add(persona);
      evidence.push({ persona, source: `explicit current action persona: ${persona}`, reason: 'required-persona-context' });
    }
  }

  const routePersonas = new Set(availablePersonas);
  const requiredPersonas = [...required].sort();
  const missingPersonas = requiredPersonas.filter((persona) => !routePersonas.has(persona));
  const packetOnlyPersonas = [...packetized].sort();
  const warnings = [];
  if (missingPersonas.length > 0) {
    warnings.push(`required persona(s) ${missingPersonas.join(', ')} appear in next/dispatch context, but route ${route?.id || 'unknown'} has only ${availablePersonas.join(', ') || 'no'} persona lanes`);
  }
  if (packetOnlyPersonas.length > 0) {
    warnings.push(`packetized or not-executed persona work detected for ${packetOnlyPersonas.join(', ')}; dispatch packets do not satisfy execution evidence`);
  }

  return {
    ok: missingPersonas.length === 0 && packetOnlyPersonas.length === 0,
    routeId: route?.id || null,
    availablePersonas,
    requiredPersonas,
    missingPersonas,
    packetOnlyPersonas,
    evidence,
    warnings
  };
}

function currentActionExplicitPersonas(sourceText) {
  const personas = new Set();
  for (const segment of String(sourceText || '').split(/\r?\n/).flatMap(currentActionSegments)) {
    const match = segment.match(/\brequired personas?\s*:\s*([A-Za-z, ]+)/i);
    if (!match) continue;
    for (const rawPersona of match[1].split(/[, ]+/)) {
      const persona = rawPersona.trim().toLowerCase();
      if (SPECIALIZED_PERSONAS.has(persona)) personas.add(persona);
    }
  }
  return personas;
}

function currentActionSegments(rawLine) {
  const normalized = String(rawLine || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  return normalized
    .split(/(?=\*\*(?:Founder-gated|Residual|Rotation|Boundary|Outcome|Owner|What|Process|Status|Next session should)\b)|(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.replace(/\*\*Founder-gated remaining:\*\*.*$/i, '').trim())
    .filter(Boolean)
    .filter(isCurrentActionSegment);
}

function isCurrentActionSegment(segment) {
  if (!CURRENT_ACTION_PATTERNS.some((pattern) => pattern.test(segment))) return false;
  if (NON_CURRENT_CONTEXT_PATTERNS.some((pattern) => pattern.test(segment))) return false;
  return true;
}

function isRequiredPersonaLine(line) {
  if (/\b(?:Next Action|Recommended next atom|current atom|Atom to land|required persona)\b.*\b(?:Owner|Executor(?:s)?|Lane|Persona)\s*:\s*(?:\*\*)?\s*(Phil|Quinn|Talia|Ian)\b/i.test(line)) {
    return true;
  }
  if (/\|\s*(Phil|Quinn|Talia|Ian)\s*\|/i.test(line)) return true;
  return REQUIRED_CONTEXT_PATTERNS.some((pattern) => pattern.test(line));
}

function isPacketOnlyPersonaLine(line) {
  if (NON_CURRENT_CONTEXT_PATTERNS_FOR_PACKET.some((pattern) => pattern.test(line))) return false;
  return PACKET_OR_NOT_EXECUTED_PATTERNS.some((pattern) => pattern.test(line));
}

const NON_CURRENT_CONTEXT_PATTERNS_FOR_PACKET = NON_CURRENT_CONTEXT_PATTERNS.filter((pattern) =>
  !String(pattern).includes('deferred')
);

function summarizeLine(line) {
  const normalized = String(line || '').replace(/\s+/g, ' ').trim();
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}
