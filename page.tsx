'use client';

import React, { useEffect, useMemo, useState } from 'react';

type Level = 'easy' | 'medium' | 'hard';

type ColorKey = 'rojo' | 'azul' | 'amarillo';

type Swatch = {
  id: string;      // único (ej: 'rojo_base', 'rojo_rosado', etc.)
  label: ColorKey; // para saber cuál es el color objetivo (rojo/azul/amarillo)
  hex: string;     // color real a pintar
};

type Round = {
  id: string;
  target: ColorKey;
  level: Level;
  options: Swatch[]; // 3 círculos
};

type Attempt = {
  roundId: string;
  target: ColorKey;
  chosen: ColorKey;
  correct: boolean;
  hintsUsed: number;
  ts: number;
  latencySec: number;
  frustration: number;
  frustrationComponents: {
    e: number;
    h: number;
    r: number;
    t: number;
    s: number;
  };
  action: 'keep' | 'support' | 'ease';
  source: 'backend' | 'fallback';
  levelBefore: Level;
  levelAfter: Level;
  rule: 'none' | 'support_by_frustration' | 'ease_by_frustration' | 'levelup_by_streak';

};

type Persisted = {
  v: number;
  attempts: Attempt[];
};

const IA_URL = "http://localhost:3001";
const STORAGE_KEY = 'tea-math-color-tap-v1';
const STORAGE_VERSION = 1;
const MAX_ATTEMPTS = 100;

const COLOR_LABEL: Record<ColorKey, string> = {
  rojo: 'ROJO',
  azul: 'AZUL',
  amarillo: 'AMARILLO',
};

const SOFT_BG = '#FBF7F0';

const SWATCHES: Record<ColorKey, Record<Level, Swatch[]>> = {
  rojo: {
    easy: [
      { id: 'rojo_base', label: 'rojo', hex: '#FF5A5F' },
    ],
    medium: [
      { id: 'rojo_base', label: 'rojo', hex: '#FF5A5F' },
      { id: 'rojo_rosado', label: 'rojo', hex: '#FF7AA2' },   // parecido
      { id: 'rojo_naranja', label: 'rojo', hex: '#FF6B3D' },  // cercano
    ],
    hard: [
      { id: 'rojo_base', label: 'rojo', hex: '#FF5A5F' },
      { id: 'rojo_coral', label: 'rojo', hex: '#FF6F61' },
      { id: 'rojo_salmon', label: 'rojo', hex: '#FF7F7F' },
    ],
  },
  azul: {
    easy: [{ id: 'azul_base', label: 'azul', hex: '#3B82F6' }],
    medium: [
      { id: 'azul_base', label: 'azul', hex: '#3B82F6' },
      { id: 'azul_cielo', label: 'azul', hex: '#60A5FA' },
      { id: 'azul_profundo', label: 'azul', hex: '#2563EB' },
    ],
    hard: [
      { id: 'azul_base', label: 'azul', hex: '#3B82F6' },
      { id: 'azul_indigo', label: 'azul', hex: '#4F46E5' },
      { id: 'azul_marino', label: 'azul', hex: '#1D4ED8' },
    ],
  },
  amarillo: {
    easy: [{ id: 'amarillo_base', label: 'amarillo', hex: '#FBBF24' }],
    medium: [
      { id: 'amarillo_base', label: 'amarillo', hex: '#FBBF24' },
      { id: 'amarillo_dorado', label: 'amarillo', hex: '#F59E0B' },
      { id: 'amarillo_claro', label: 'amarillo', hex: '#FCD34D' },
    ],
    hard: [
      { id: 'amarillo_base', label: 'amarillo', hex: '#FBBF24' },
      { id: 'amarillo_calido', label: 'amarillo', hex: '#F4B400' },
      { id: 'amarillo_mostaza', label: 'amarillo', hex: '#DFAF2B' },
    ],
  },
};

const BASE_COLOR: Record<ColorKey, string> = {
  rojo: '#FF3B30',
  azul: '#007AFF',
  amarillo: '#FFD60A',
};

function clamp(v: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v));
}

function computeFrustration(params: {
  errorsConsecutive: number;
  hintsUsed: number;
  retriesSameRound: number;
  latencySec: number;
  perseveration: number;
}) {
  const e = clamp(params.errorsConsecutive / 3);
  const h = clamp(params.hintsUsed / 2);
  const r = clamp(params.retriesSameRound / 2);
  const t = clamp((params.latencySec - 3) / (12 - 3));
  const s = clamp(params.perseveration / 2);

  const F =
    0.35 * e +
    0.20 * h +
    0.15 * r +
    0.20 * t +
    0.10 * s;

  return {
    value: Number(F.toFixed(2)),
    components: { e, h, r, t, s },
  };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickOne<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeBaseSwatch(color: ColorKey): Swatch {
  return {
    id: `${color}_${Math.random().toString(16).slice(2)}`,
    label: color,
    hex: BASE_COLOR[color],
  };
}

function makeRound(prevTarget?: ColorKey, level: Level = 'easy'): Round {
  const all: ColorKey[] = ['rojo', 'azul', 'amarillo'];

  const candidates = prevTarget ? all.filter(c => c !== prevTarget) : all;
  const target = candidates[Math.floor(Math.random() * candidates.length)];

  // ✅ Correcto: siempre 1 SOLO swatch con label === target
  const correctSwatch =
    level === 'easy'
      ? makeBaseSwatch(target)
      : {
          ...pickOne(SWATCHES[target][level]),
          id: `${target}_${Math.random().toString(16).slice(2)}`,
        };

  // ✅ Distractores: SIEMPRE base y SIEMPRE nuevos
  const distractors = all
    .filter(c => c !== target)
    .map(c => makeBaseSwatch(c));

  const options = shuffle([correctSwatch, ...distractors]);

  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    target,
    level,
    options,
  };
}


// --- Persistencia mínima ---
function safeLoad(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Persisted;
    if (!parsed || parsed.v !== STORAGE_VERSION) return null;
    if (!Array.isArray(parsed.attempts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function safeSave(data: Persisted) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function downloadJson(filename: string, data: unknown) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function formatDateForFile(ts = Date.now()) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function getDecisionFromBackend(payload: any) {
  const res = await fetch(`${IA_URL}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error("backend decision failed");
  return res.json();
}

export default function Page() {
  const [decisionSource, setDecisionSource] = useState<'backend' | 'fallback'>('fallback');
  // --- Estado principal de la actividad ---
  const [level, setLevel] = useState<Level>('easy');
  const [round, setRound] = useState<Round>(() => makeRound(undefined, 'easy'));
  const [feedback, setFeedback] = useState<'idle' | 'correct' | 'wrong'>('idle');
  const [lastChosen, setLastChosen] = useState<ColorKey | null>(null);
  const [successStreak, setSuccessStreak] = useState(0);
  const [pendingLevelUp, setPendingLevelUp] = useState(false);
  const [highFrustrationStreak, setHighFrustrationStreak] = useState(0);



  // Pistas (solo visual)
  const [hintOn, setHintOn] = useState(false);
  const [hintsUsed, setHintsUsed] = useState(0);

  // Registro de intentos
  const [attempts, setAttempts] = useState<Attempt[]>([]);

  // ⏱ tiempo
  const [roundStartTs, setRoundStartTs] = useState<number>(Date.now());

  // ❌ errores
  const [errorsConsecutive, setErrorsConsecutive] = useState(0);

  // 🔁 reintentos en la misma ronda
  const [retriesSameRound, setRetriesSameRound] = useState(0);

  // 🧠 perseveración (mismo error repetido)
  const [lastWrongChoice, setLastWrongChoice] = useState<string | null>(null);
  const [perseveration, setPerseveration] = useState(0);

  useEffect(() => {
  // Arranque limpio en cliente (evita hydration mismatch)
  setLevel('easy');

  const r = makeRound(undefined, 'easy');
  setRound(r);

  setFeedback('idle');
  setLastChosen(null);
  setHintOn(false);
  setHintsUsed(0);

  setRoundStartTs(Date.now());
  setErrorsConsecutive(0);
  setRetriesSameRound(0);
  setLastWrongChoice(null);
  setPerseveration(0);

  setSuccessStreak(0);
  setPendingLevelUp(false);
}, []);

  // Cargar historial (para export / continuidad)
  useEffect(() => {
    const loaded = safeLoad();
    if (loaded) setAttempts(loaded.attempts.slice(0, MAX_ATTEMPTS));
  }, []);

  // Guardar historial
  useEffect(() => {
    const t = window.setTimeout(() => {
      safeSave({ v: STORAGE_VERSION, attempts: attempts.slice(0, MAX_ATTEMPTS) });
    }, 120);
    return () => window.clearTimeout(t);
  }, [attempts]);

  useEffect(() => {
  if (!pendingLevelUp) return;

    setLevel((lvl) => nextLevel(lvl, 'up'));
    setPendingLevelUp(false);
  }, [pendingLevelUp]);

  function nextRound() {
    // Si todavía no hay ronda (arranque), crea una
    if (!round) {
      const r = makeRound(undefined, level);
      setRound(r);
      setRoundStartTs(Date.now());
      return;
    }

    const r = makeRound(round.target, level);
    setRound(r);

    setFeedback('idle');
    setLastChosen(null);
    setHintOn(false);
    setHintsUsed(0);

    setRoundStartTs(Date.now());
    setErrorsConsecutive(0);
    setRetriesSameRound(0);
    setLastWrongChoice(null);
    setPerseveration(0);
  }

  function nextLevel(current: Level, dir: 'up' | 'down'): Level {
    const order: Level[] = ['easy', 'medium', 'hard'];
    const idx = order.indexOf(current);

    if (dir === 'up') return order[Math.min(idx + 1, order.length - 1)];
    return order[Math.max(idx - 1, 0)];
  }

  function useHint() {
    // Pista: resaltar el correcto (sin texto extra)
    setHintOn(true);
    setHintsUsed((n) => n + 1);
  }

 async function onPick(swatch: Swatch) {
  if (!round) return;

  // ⏱ Latencia (en segundos) usando roundStartTs
  const latencySec = Math.round((Date.now() - roundStartTs) / 1000);

  // ¿Es correcto?
  const correct = swatch.label === round.target;

  setLastChosen(swatch.label);
  setFeedback(correct ? 'correct' : 'wrong');

  // --------- MÉTRICAS (usar variables locales para coherencia) ----------
  let nextErrorsConsecutive = errorsConsecutive;
  let nextRetriesSameRound = retriesSameRound;
  let nextPerseveration = perseveration;

  if (correct) {
    nextErrorsConsecutive = 0;
    nextRetriesSameRound = 0;
    nextPerseveration = 0;

    setErrorsConsecutive(0);
    setRetriesSameRound(0);
    setLastWrongChoice(null);
    setPerseveration(0);
  } else {
    nextErrorsConsecutive = errorsConsecutive + 1;
    nextRetriesSameRound = retriesSameRound + 1;

    setErrorsConsecutive(nextErrorsConsecutive);
    setRetriesSameRound(nextRetriesSameRound);

    if (lastWrongChoice === swatch.id) {
      nextPerseveration = perseveration + 1;
      setPerseveration(nextPerseveration);
    } else {
      setLastWrongChoice(swatch.id);
      nextPerseveration = perseveration;
    }
  }

  // --------- 1) PEDIR DECISIÓN AL BACKEND (con fallback) ----------
  let decision: {
    frustration: { value: number; components: { e: number; h: number; r: number; t: number; s: number } };
    action: 'keep' | 'support' | 'ease';
    suggestedLevel: Level;
    nextHighFrustrationStreak: number;
    nextSuccessStreak: number;
  };
  let source: 'backend' | 'fallback' = 'fallback';

  try {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 800);

  const res = await fetch(`${IA_URL}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({
      level,
      errorsConsecutive: nextErrorsConsecutive,
      hintsUsed,
      retriesSameRound: nextRetriesSameRound,
      latencySec,
      perseveration: nextPerseveration,
      highFrustrationStreak,
      successStreak,
      correct,
    }),
  });

  window.clearTimeout(timeout);

  if (!res.ok) throw new Error('backend not ok');

  decision = await res.json();

  // ✅ solo si todo salió bien:
  source = 'backend';
  setDecisionSource('backend');
} catch {
    source = 'fallback';
    setDecisionSource('fallback');
    // ✅ FALLBACK LOCAL (misma lógica que el backend)
    const frustration = computeFrustration({
      errorsConsecutive: nextErrorsConsecutive,
      hintsUsed,
      retriesSameRound: nextRetriesSameRound,
      latencySec,
      perseveration: nextPerseveration,
    });

    const isHigh = frustration.value >= 0.65;
    const nextHigh = isHigh ? highFrustrationStreak + 1 : 0;

    let action: 'keep' | 'support' | 'ease';
    if (frustration.value < 0.35) action = 'keep';
    else if (frustration.value < 0.65) action = 'support';
    else action = nextHigh >= 2 ? 'ease' : 'support';

    let suggestedLevel: Level = level;
    let nextSuccess = correct ? successStreak + 1 : 0;

    if (action === 'ease') {
      suggestedLevel = nextLevel(level, 'down');
      nextSuccess = 0;
    } else if (nextSuccess >= 3) {
      suggestedLevel = nextLevel(level, 'up');
      nextSuccess = 0;
    }

    decision = {
      frustration,
      action,
      suggestedLevel,
      nextHighFrustrationStreak: action === 'ease' ? 0 : nextHigh,
      nextSuccessStreak: nextSuccess,
    };
  }

  const { frustration, action, suggestedLevel, nextHighFrustrationStreak, nextSuccessStreak } = decision;

  // --------- 2) APLICAR ESTADOS DEVUELTOS POR EL MOTOR IA ----------
  setHighFrustrationStreak(nextHighFrustrationStreak);
  setSuccessStreak(nextSuccessStreak);

  if (suggestedLevel !== level) setLevel(suggestedLevel);
  if (action === 'support') setHintOn(true);

const rule: Attempt['rule'] =
  action === 'support'
    ? 'support_by_frustration'
    : action === 'ease'
    ? 'ease_by_frustration'
    : suggestedLevel !== level
    ? 'levelup_by_streak'
    : 'none';

  // --------- 3) REGISTRO DEL INTENTO ----------
    setAttempts((prev) =>
      [
        {
          roundId: round.id,
          target: round.target,
          chosen: swatch.label,
          correct,
          hintsUsed,
          ts: Date.now(),
          latencySec,
          frustration: frustration.value,
          frustrationComponents: frustration.components,
          action,
          source,
          levelBefore: level,     
          levelAfter: suggestedLevel,
          rule,
        },
        ...prev,
      ].slice(0, MAX_ATTEMPTS)
    );


  // --------- 4) FLUJO DE LA ACTIVIDAD ----------
  // Si el motor decidió "ease": regenerar ronda inmediata con el nivel sugerido
  if (action === 'ease') {
    setFeedback('idle');
    setLastChosen(null);
    setHintOn(false);
    setHintsUsed(0);

    setRound(makeRound(round.target, suggestedLevel));
    setRoundStartTs(Date.now()); // ✅ aquí sí es válido (handler)

    setErrorsConsecutive(0);
    setRetriesSameRound(0);
    setLastWrongChoice(null);
    setPerseveration(0);

    return;
  }

  // Si acertó: avanzar tras una pausa, usando suggestedLevel (evita estado stale)
  if (correct) {
    setTimeout(() => {
      setRound(makeRound(round.target, suggestedLevel));
      setFeedback('idle');
      setLastChosen(null);
      setHintOn(false);
      setHintsUsed(0);

      setRoundStartTs(Date.now()); // ✅ válido dentro de callback

      setErrorsConsecutive(0);
      setRetriesSameRound(0);
      setLastWrongChoice(null);
      setPerseveration(0);
    }, 700);
  } else {
    setTimeout(() => setHintOn(false), 400);
  }
}

  const stats = useMemo(() => {
    const total = attempts.length;
    const correct = attempts.filter((a) => a.correct).length;
    const accuracy = total === 0 ? 0 : Math.round((correct / total) * 100);
    return { total, correct, accuracy };
  }, [attempts]);

  const dash = useMemo(() => {
  const total = attempts.length;
  if (total === 0) {
    return {
      total: 0,
      accuracy: 0,
      avgLatency: 0,
      avgFrustration: 0,
      supportPct: 0,
      easePct: 0,
      hintAvg: 0,
      backendPct: 0,
    };
  }

  const correctCount = attempts.filter((a) => a.correct).length;
  const accuracy = Math.round((correctCount / total) * 100);

  const avgLatency = Math.round(
    (attempts.reduce((sum, a) => sum + a.latencySec, 0) / total) * 10
  ) / 10;

  const avgFrustration = Math.round(
    (attempts.reduce((sum, a) => sum + a.frustration, 0) / total) * 100
  ) / 100;

  const supportCount = attempts.filter((a) => a.action === 'support').length;
  const easeCount = attempts.filter((a) => a.action === 'ease').length;

  const supportPct = Math.round((supportCount / total) * 100);
  const easePct = Math.round((easeCount / total) * 100);

  const hintAvg = Math.round(
    (attempts.reduce((sum, a) => sum + a.hintsUsed, 0) / total) * 10
  ) / 10;

  const backendCount = attempts.filter((a) => a.source === 'backend').length;
  const backendPct = Math.round((backendCount / total) * 100);

  return {
    total,
    accuracy,
    avgLatency,
    avgFrustration,
    supportPct,
    easePct,
    hintAvg,
    backendPct,
  };
}, [attempts]);

  const last = attempts[0];

  function exportJson() {
    const payload = {
      exportedAt: new Date().toISOString(),
      activity: 'tap-color',
      targets: ['rojo', 'azul', 'amarillo'],
      attempts,
      stats,
    };
    downloadJson(`actividadA_sesion_${formatDateForFile()}.json`, payload);
  }

  function resetAll() {
    setAttempts([]);
    safeSave({ v: STORAGE_VERSION, attempts: [] });

    setLevel('easy');
    const r = makeRound(undefined, 'easy');
    setRound(r);

    setFeedback('idle');
    setLastChosen(null);
    setHintOn(false);
    setHintsUsed(0);

    setRoundStartTs(Date.now());
    setErrorsConsecutive(0);
    setRetriesSameRound(0);
    setLastWrongChoice(null);
    setPerseveration(0);

    setSuccessStreak(0);
    setPendingLevelUp(false);

    // (lo agregamos en C)
    setHighFrustrationStreak(0);
  }


  if (!round) {
    return (
      <main
        style={{
          minHeight: '100vh',
          background: SOFT_BG,
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto',
        }}
      >
        <div style={{ opacity: 0.6, fontSize: 18 }}>Cargando…</div>
      </main>
    );
  }

  // UI helper
  const instructionColor = round.options.find(
    (o) => o.label === round.target
  )?.hex ?? '#000';


  return (
    <main
      style={{
        minHeight: '100vh',
        background: SOFT_BG,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto',
      }}
    >
      <div
        style={{
          width: 'min(920px, 100%)',
          background: 'rgba(255,255,255,0.65)',
          border: '1px solid rgba(0,0,0,0.08)',
          borderRadius: 28,
          padding: '28px 22px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.06)',
        }}
      >
        {/* Header minimal */}
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1, color: 'rgba(0,0,0,0.78)' }}>
            Toca el color
          </div>
          <div style={{ fontSize: 54, fontWeight: 900, letterSpacing: 1.5, marginTop: 4, color: instructionColor }}>
            {COLOR_LABEL[round.target]}
          </div>
        </div>

        {/* Circles row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 28,
            flexWrap: 'wrap',
            padding: '18px 8px 8px',
          }}
        >
          {round.options.map((sw) => {
            const isTarget = sw.label === round.target;
            const showHint = hintOn && isTarget;

            const isChosen = lastChosen === sw.label;

            return (
              <button
                key={sw.id}
                onClick={() => onPick(sw)}
                aria-label={`Color ${COLOR_LABEL[sw.label]}`}
                style={{
                  width: 190,
                  height: 190,
                  borderRadius: 999,
                  border: showHint ? `6px solid rgba(0,0,0,0.18)` : `6px solid rgba(0,0,0,0.06)`,
                  background: sw.hex,
                  cursor: 'pointer',
                  boxShadow: '0 12px 25px rgba(0,0,0,0.12)',
                }}
              />
            );
          })}

        </div>

        {/* Soft feedback (no texto largo) */}
        <div style={{ height: 34, marginTop: 10, textAlign: 'center' }}>
          {feedback === 'correct' && (
            <span style={{ fontSize: 18, fontWeight: 700, color: 'rgba(34,197,94,0.95)' }}>✓</span>
          )}
          {feedback === 'wrong' && (
            <span style={{ fontSize: 18, fontWeight: 700, color: 'rgba(239,68,68,0.9)' }}>↩</span>
          )}
        </div>

        {/* Bottom controls: solo 1 botón visible al niño */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
          <button
            onClick={useHint}
            style={{
              padding: '12px 18px',
              borderRadius: 16,
              border: '1px solid rgba(0,0,0,0.12)',
              background: 'rgba(255,255,255,0.9)',
              cursor: 'pointer',
              fontSize: 16,
              fontWeight: 650,
            }}
          >
            Pista
          </button>
        </div>

        {/* Pagination dots (visual como mockup) */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 16 }}>
          <Dot active />
          <Dot />
          <Dot />
        </div>

        {/* Panel adulto: export + stats (no invade) */}
        <details style={{ marginTop: 18 }}>
          
          {last && (
            <div style={{ marginTop: 10, padding: 12, borderRadius: 14, background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.08)' }}>
              <div style={{ opacity: 0.85 }}>
                Último intento → F: <b>{last.frustration}</b> · Acción: <b>{last.action}</b> · Latencia: <b>{last.latencySec}s</b>
              </div>
              <div style={{ opacity: 0.7, marginTop: 6, fontSize: 13 }}>
                Componentes → e:{' '}
                <b>{last.frustrationComponents.e.toFixed(2)}</b> · h:{' '}
                <b>{last.frustrationComponents.h.toFixed(2)}</b> · r:{' '}
                <b>{last.frustrationComponents.r.toFixed(2)}</b> · t:{' '}
                <b>{last.frustrationComponents.t.toFixed(2)}</b> · s:{' '}
                <b>{last.frustrationComponents.s.toFixed(2)}</b>
              </div>
            </div>
          )}

          <summary style={{ cursor: 'pointer', opacity: 0.7 }}>Panel adulto</summary>
          <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={exportJson}
              style={{
                padding: '10px 14px',
                borderRadius: 14,
                border: '1px solid rgba(0,0,0,0.12)',
                background: 'white',
                cursor: 'pointer',
              }}
            >
              Descargar JSON
            </button>

            <button
              onClick={resetAll}
              style={{
                padding: '10px 14px',
                borderRadius: 14,
                border: '1px solid rgba(0,0,0,0.12)',
                background: 'white',
                cursor: 'pointer',
              }}
            >
              Reiniciar sesión
            </button>
            <span style={{ opacity: 0.75 }}>Nivel: <b>{level}</b></span>
            <span style={{ opacity: 0.75 }}>
              Intentos: <b>{stats.total}</b> · Aciertos: <b>{stats.correct}</b> · Precisión: <b>{stats.accuracy}%</b>
            </span>
            <span style={{ opacity: 0.75 }}>
              Motor: <b>{decisionSource}</b>
            </span>
          </div>
          <div
            style={{
              marginTop: 12,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 10,
            }}
          >
            <DashCard label="Intentos" value={dash.total} />
            <DashCard label="Precisión" value={`${dash.accuracy}%`} />
            <DashCard label="Latencia prom." value={`${dash.avgLatency}s`} />
            <DashCard label="Frustración prom." value={dash.avgFrustration} />
            <DashCard label="Soporte (auto)" value={`${dash.supportPct}%`} />
            <DashCard label="Baja nivel (auto)" value={`${dash.easePct}%`} />
            <DashCard label="Pistas prom." value={dash.hintAvg} />
            <DashCard label="Motor backend" value={`${dash.backendPct}%`} />
          </div>

        </details>
      </div>
    </main>
  );
}

function Dot({ active = false }: { active?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 10,
        height: 10,
        borderRadius: 999,
        background: active ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.18)',
        display: 'inline-block',
      }}
    />
  );
}

function DashCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 14,
        background: 'rgba(255,255,255,0.85)',
        border: '1px solid rgba(0,0,0,0.08)',
        boxShadow: '0 6px 14px rgba(0,0,0,0.05)',
      }}
    >
      <div style={{ fontSize: 12, letterSpacing: 0.3, opacity: 0.65 }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 20, fontWeight: 800, color: 'rgba(0,0,0,0.78)' }}>
        {value}
      </div>
    </div>
  );
}
