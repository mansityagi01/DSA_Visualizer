// ============================================================================
// FILE 6/6: VisualizerEngine.jsx
// React Three Fiber God-Component — 3D Physics, Animations, All Data Structures
// Principal Engineer (L8) @ Google + Lead Graphics Programmer @ Epic Games
// ============================================================================

import React, {
  useRef, useState, useEffect, useMemo, useCallback, Suspense
} from 'react';
import { Canvas, useFrame, useThree, extend } from '@react-three/fiber';
import {
  OrbitControls, Text, Text3D, Float, Sparkles, Trail,
  MeshDistortMaterial, MeshWobbleMaterial, Environment,
  useMatcapTexture, Billboard, Line, QuadraticBezierLine,
  CubicBezierLine, Sphere, Box, Cylinder, Torus, Cone,
  RoundedBox, Html, Stars, Cloud, ContactShadows,
  GradientTexture, Outlines, Edges, useCursor, SoftShadows,
  BakeShadows, AccumulativeShadows,
  RandomizedLight, Caustics, MeshReflectorMaterial,
  useFBO, useTexture, CameraShake, Fisheye
} from '@react-three/drei';
import {
  Physics, RigidBody, CuboidCollider, BallCollider,
  CylinderCollider, useRapier, useRevoluteJoint
} from '@react-three/rapier';
import { useSpring, animated, config as springConfig } from '@react-spring/three';
import * as THREE from 'three';

// LITE/DEV mode to reduce heavy effects during development
const IS_DEV = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.MODE !== 'production';

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL CONSTANTS & COLOR PALETTE
// ─────────────────────────────────────────────────────────────────────────────
const PALETTE = {
  primary:   '#a78bfa',   // violet-400
  secondary: '#f472b6',   // pink-400
  accent:    '#34d399',   // emerald-400
  warning:   '#fbbf24',   // amber-400
  danger:    '#f87171',   // red-400
  info:      '#60a5fa',   // blue-400
  dark:      '#0f0a1a',
  glow:      '#c084fc',
  gold:      '#ffd700',
  teal:      '#2dd4bf',
  orange:    '#fb923c',
  neon:      '#39ff14',
};

const DS_COLORS = {
  ARRAY:        { base: '#6366f1', glow: '#818cf8', edge: '#4f46e5' },
  LINKED_LIST:  { base: '#ec4899', glow: '#f472b6', edge: '#db2777' },
  STACK:        { base: '#f59e0b', glow: '#fbbf24', edge: '#d97706' },
  QUEUE:        { base: '#10b981', glow: '#34d399', edge: '#059669' },
  BINARY_TREE:  { base: '#8b5cf6', glow: '#a78bfa', edge: '#7c3aed' },
  GRAPH:        { base: '#06b6d4', glow: '#22d3ee', edge: '#0891b2' },
  HASH_TABLE:   { base: '#f97316', glow: '#fb923c', edge: '#ea580c' },
  TRIE:         { base: '#84cc16', glow: '#a3e635', edge: '#65a30d' },
  HEAP:         { base: '#ef4444', glow: '#f87171', edge: '#dc2626' },
  WATER_JUG:    { base: '#3b82f6', glow: '#60a5fa', edge: '#2563eb' },
  CUSTOM:       { base: '#a78bfa', glow: '#c084fc', edge: '#7c3aed' },
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY HOOKS
// ─────────────────────────────────────────────────────────────────────────────

/** Smooth lerp on every animation frame */
function useLerp(target, factor = 0.08) {
  const val = useRef(target);
  useFrame(() => {
    val.current = THREE.MathUtils.lerp(val.current, target, factor);
  });
  return val;
}

/** Pulsing glow intensity */
function usePulse(speed = 1, min = 0.6, max = 1.4) {
  const ref = useRef(min);
  useFrame(({ clock }) => {
    ref.current = min + (Math.sin(clock.elapsedTime * speed) * 0.5 + 0.5) * (max - min);
  });
  return ref;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHADER MATERIALS (inline GLSL for glow, fresnel, holographic effects)
// ─────────────────────────────────────────────────────────────────────────────

const GlowMaterial = ({ color = '#a78bfa', intensity = 1.5, opacity = 0.85 }) => {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(color),
    emissiveIntensity: intensity,
    transparent: true,
    opacity,
    roughness: 0.1,
    metalness: 0.3,
  }), [color, intensity, opacity]);
  return <primitive object={mat} attach="material" />;
};

const HolographicMaterial = ({ color = '#60a5fa', speed = 1 }) => {
  const ref = useRef();
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.emissiveIntensity = 0.8 + Math.sin(clock.elapsedTime * speed * 3) * 0.3;
      ref.current.opacity = 0.6 + Math.sin(clock.elapsedTime * speed * 2) * 0.15;
    }
  });
  return (
    <meshStandardMaterial
      ref={ref}
      color={color}
      emissive={color}
      emissiveIntensity={0.8}
      transparent
      opacity={0.75}
      roughness={0.05}
      metalness={0.9}
      wireframe={false}
    />
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PARTICLE SYSTEMS
// ─────────────────────────────────────────────────────────────────────────────

/** Confetti explosion for array out-of-bounds / errors */
function ConfettiExplosion({ position = [0,0,0], active = false, count = 80, onDone }) {
  const meshRef = useRef();
  const particles = useRef([]);
  const [alive, setAlive] = useState(false);

  useEffect(() => {
    if (!active) return;
    setAlive(true);
    const realCount = IS_DEV ? Math.min(40, count) : count;
    particles.current = Array.from({ length: realCount }, () => ({
      position: new THREE.Vector3(...position),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 12,
        Math.random() * 10 + 4,
        (Math.random() - 0.5) * 12
      ),
      color: new THREE.Color(
        Math.random() > 0.5 ? PALETTE.danger :
        Math.random() > 0.5 ? PALETTE.warning :
        Math.random() > 0.5 ? PALETTE.primary :
        PALETTE.secondary
      ),
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 10,
      life: 1.0,
      size: Math.random() * 0.15 + 0.05,
    }));
    const t = setTimeout(() => { setAlive(false); onDone?.(); }, 1500);
    return () => clearTimeout(t);
  }, [active]);

  useFrame((_, delta) => {
    if (!alive) return;
    particles.current.forEach(p => {
      p.life -= delta * 0.5;
      p.velocity.y -= 9.8 * delta;
      p.position.addScaledVector(p.velocity, delta);
      p.rotation += p.rotSpeed * delta;
    });
  });

  if (!alive) return null;
  return (
    <group>
      {particles.current.map((p, i) => (
        <mesh key={i} position={p.position.toArray()} rotation={[p.rotation, p.rotation, 0]}>
          <planeGeometry args={[p.size, p.size * 0.5]} />
          <meshBasicMaterial color={p.color} transparent opacity={Math.max(0, p.life)} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

/** Water particle system for Water Jug overflow */
function WaterParticles({ position = [0,0,0], active = false, count = 120 }) {
  const points = useRef();
  const realCount = IS_DEV ? Math.min(40, count) : count;
  const posArr = useRef(new Float32Array(realCount * 3));
  const velArr = useRef(Array.from({ length: realCount }, () => new THREE.Vector3(
    (Math.random() - 0.5) * 4,
    Math.random() * 6,
    (Math.random() - 0.5) * 4
  )));
  const lives = useRef(Array.from({ length: realCount }, () => Math.random()));

  useEffect(() => {
    if (!active) return;
    for (let i = 0; i < realCount; i++) {
      posArr.current[i*3]   = position[0] + (Math.random()-0.5)*0.5;
      posArr.current[i*3+1] = position[1];
      posArr.current[i*3+2] = position[2] + (Math.random()-0.5)*0.5;
      lives.current[i] = Math.random();
    }
  }, [active]);

  useFrame((_, dt) => {
    if (!active || !points.current) return;
    for (let i = 0; i < realCount; i++) {
      lives.current[i] -= dt * 0.5;
      if (lives.current[i] <= 0) {
        posArr.current[i*3]   = position[0] + (Math.random()-0.5)*0.5;
        posArr.current[i*3+1] = position[1];
        posArr.current[i*3+2] = position[2] + (Math.random()-0.5)*0.5;
        velArr.current[i].set(
          (Math.random()-0.5)*4,
          Math.random()*6,
          (Math.random()-0.5)*4
        );
        lives.current[i] = 1.0;
      }
      velArr.current[i].y -= 9.8 * dt;
      posArr.current[i*3]   += velArr.current[i].x * dt;
      posArr.current[i*3+1] += velArr.current[i].y * dt;
      posArr.current[i*3+2] += velArr.current[i].z * dt;
    }
    points.current.geometry.attributes.position.needsUpdate = true;
  });

  if (!active) return null;
  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" array={posArr.current} count={realCount} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial color="#60a5fa" size={IS_DEV ? 0.06 : 0.08} transparent opacity={0.85} sizeAttenuation />
    </points>
  );
}

/** Spark burst for null-pointer dereference */
function SparkBurst({ position = [0,0,0], active = false }) {
  const [sparks] = useState(() =>
    Array.from({ length: 40 }, (_, i) => ({
      id: i,
      angle: (i / 40) * Math.PI * 2,
      speed: Math.random() * 5 + 2,
      life: 1,
    }))
  );
  if (!active) return null;
  return (
    <group position={position}>
      {sparks.map(s => (
        <Trail key={s.id} width={0.05} length={6} color={PALETTE.warning} attenuation={t => t * t}>
          <mesh position={[
            Math.cos(s.angle) * s.speed * 0.3,
            Math.abs(Math.sin(s.angle)) * s.speed * 0.3,
            Math.sin(s.angle) * s.speed * 0.3
          ]}>
            <sphereGeometry args={[0.03, 6, 6]} />
            <meshBasicMaterial color={PALETTE.warning} />
          </mesh>
        </Trail>
      ))}
      <Sparkles count={IS_DEV ? 12 : 60} scale={3} size={3} speed={0.8} color={PALETTE.warning} />
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR CHARACTER — cute 3D sprite that appears on runtime errors
// ─────────────────────────────────────────────────────────────────────────────

function ErrorCharacter({ position = [0, 3, 0], message = '💥 Oops!', type = 'SEGFAULT' }) {
  const groupRef = useRef();
  const [visible, setVisible] = useState(true);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    groupRef.current.position.y = position[1] + Math.sin(clock.elapsedTime * 2) * 0.3;
    groupRef.current.rotation.y = clock.elapsedTime * 0.5;
  });

  const errorColors = {
    SEGFAULT: PALETTE.danger,
    OUT_OF_BOUNDS: PALETTE.warning,
    STACK_OVERFLOW: PALETTE.primary,
    NULL_POINTER: '#888888',
    DIVISION_BY_ZERO: '#ff44ff',
    OVERFLOW: PALETTE.info,
  };
  const col = errorColors[type] || PALETTE.danger;

  if (!visible) return null;
  return (
    <Float speed={2} rotationIntensity={0.4} floatIntensity={0.8}>
      <group ref={groupRef} position={position}>
        {/* Body */}
        <mesh>
          <sphereGeometry args={[0.5, 16, 16]} />
          <meshStandardMaterial color={col} emissive={col} emissiveIntensity={0.8} roughness={0.2} />
        </mesh>
        {/* Eyes */}
        {[[-0.18, 0.15, 0.42], [0.18, 0.15, 0.42]].map(([x, y, z], i) => (
          <mesh key={i} position={[x, y, z]}>
            <sphereGeometry args={[0.09, 8, 8]} />
            <meshBasicMaterial color="white" />
          </mesh>
        ))}
        {/* Pupils */}
        {[[-0.18, 0.15, 0.51], [0.18, 0.15, 0.51]].map(([x, y, z], i) => (
          <mesh key={i} position={[x, y, z]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshBasicMaterial color="#111" />
          </mesh>
        ))}
        {/* Message billboard */}
        <Billboard>
          <Text
            position={[0, 0.85, 0]}
            fontSize={0.22}
            color="white"
            outlineColor={col}
            outlineWidth={0.02}
            anchorX="center"
            anchorY="middle"
            font="https://fonts.gstatic.com/s/orbitron/v31/yMJRMIlzdpvBhQQL_Qq7dy0.woff"
          >
            {message}
          </Text>
        </Billboard>
        <Sparkles count={IS_DEV ? 6 : 20} scale={1.5} size={2} speed={0.5} color={col} />
      </group>
    </Float>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POINTER ORB — glowing animated orb for C++ pointer variables
// ─────────────────────────────────────────────────────────────────────────────

function PointerOrb({ from, to, color = PALETTE.gold, label = '', isNull = false }) {
  const orbRef = useRef();
  const trailRef = useRef();

  const { pos } = useSpring({
    pos: to,
    config: { mass: 1, tension: 280, friction: 35 },
  });

  useFrame(({ clock }) => {
    if (!orbRef.current) return;
    orbRef.current.material.emissiveIntensity = 0.8 + Math.sin(clock.elapsedTime * 4) * 0.3;
    orbRef.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 6) * 0.05);
  });

  return (
    <group>
      {/* Bezier curve connecting from → to */}
      <QuadraticBezierLine
        start={from}
        end={to}
        mid={[
          (from[0] + to[0]) / 2,
          Math.max(from[1], to[1]) + 2.5,
          (from[2] + to[2]) / 2,
        ]}
        color={isNull ? '#555' : color}
        lineWidth={2}
        dashed={isNull}
        dashScale={isNull ? 20 : 1}
      />
      {/* Orb */}
      <Trail width={0.15} length={8} color={color} attenuation={t => t * t * t}>
        <animated.mesh ref={orbRef} position={pos}>
          <sphereGeometry args={[0.2, 20, 20]} />
          <meshStandardMaterial
            color={isNull ? '#444' : color}
            emissive={isNull ? '#222' : color}
            emissiveIntensity={isNull ? 0.2 : 1.0}
            roughness={0.05}
            metalness={0.6}
            transparent
            opacity={isNull ? 0.4 : 0.95}
          />
        </animated.mesh>
      </Trail>
      {/* Label */}
      {label && (
        <Billboard position={to}>
          <Text fontSize={0.18} color={color} anchorX="center">
            {label}
          </Text>
        </Billboard>
      )}
      {/* NULL marker */}
      {isNull && (
        <mesh position={to}>
          <torusGeometry args={[0.2, 0.04, 8, 20]} />
          <meshBasicMaterial color="#555" />
        </mesh>
      )}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ARRAY — train-coach style, connected cars with cute roofs
// ─────────────────────────────────────────────────────────────────────────────

function ArrayCoach({ slotIndex, value, highlight = false, liftDir = 0, color, spacing = 1.8 }) {
  const meshRef = useRef();
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);

  const { scale } = useSpring({
    scale: highlight ? 1.18 : hovered ? 1.08 : 1,
    config: springConfig.wobbly,
  });

  const { x, y, z } = useSpring({
    x: slotIndex * spacing - 4,
    y: (liftDir ? 0.85 * Math.sign(liftDir) : 0) + (highlight ? 0.1 : 0),
    z: liftDir ? 0.25 : 0,
    config: springConfig.stiff,
  });

  return (
    <animated.group position-x={x} position-y={y} position-z={z}>
      {/* Coach body */}
      <animated.mesh
        ref={meshRef}
        scale={scale}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <RoundedBox args={[1.4, 0.9, 0.9]} radius={0.12} smoothness={4}>
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={highlight ? 1.2 : 0.35}
            roughness={0.15}
            metalness={0.4}
          />
        </RoundedBox>
      </animated.mesh>

      {/* Cute roof */}
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.55, 0.7, 0.22, 6]} />
        <meshStandardMaterial color={new THREE.Color(color).multiplyScalar(0.7)} roughness={0.3} />
      </mesh>

      {/* Wheels */}
      {[[-0.45, -0.52, 0.45], [0.45, -0.52, 0.45], [-0.45, -0.52, -0.45], [0.45, -0.52, -0.45]].map(([wx, wy, wz], wi) => (
        <mesh key={wi} position={[wx, wy, wz]} rotation={[Math.PI/2, 0, 0]}>
          <cylinderGeometry args={[0.14, 0.14, 0.1, 12]} />
          <meshStandardMaterial color="#222" roughness={0.8} />
        </mesh>
      ))}

      {/* Connector link to next coach */}
      {slotIndex > 0 && (
        <mesh position={[-0.9, 0, 0]}>
          <boxGeometry args={[0.3, 0.1, 0.08]} />
          <meshStandardMaterial color="#888" metalness={0.9} roughness={0.2} />
        </mesh>
      )}

      {/* Window */}
      <mesh position={[0, 0.08, 0.46]}>
        <planeGeometry args={[0.7, 0.4]} />
        <meshStandardMaterial color="#88ccff" transparent opacity={0.5} emissive="#88ccff" emissiveIntensity={0.3} />
      </mesh>

      {/* Index label */}
      <Text position={[0, -0.9, 0]} fontSize={0.18} color="#aaa" anchorX="center">[{slotIndex}]</Text>

      {/* Value label */}
      <Text position={[0, 0.05, 0.5]} fontSize={0.28} color="white" anchorX="center" outlineColor={color} outlineWidth={0.02}>
        {String(value ?? '?')}
      </Text>

      {/* Glow */}
      {highlight && <Sparkles count={IS_DEV ? 4 : 10} scale={1.8} size={2} speed={0.3} color={color} />}
    </animated.group>
  );
}

function ArrayVisualizer({ variables, currentLine, currentFrame }) {
  const arrays = useMemo(() => {
    const result = [];
    for (const [name, data] of Object.entries(variables || {})) {
      if (data.isArray && Array.isArray(data.value)) {
        // Support both raw number arrays and array-item objects like:
        // [{ id, index, value }, ...] which come from the action-script planner.
        const normalized = data.value.map((entry, index) => {
          if (entry && typeof entry === 'object') {
            return {
              id: entry.id || `${name}-${index}-${String(entry.value ?? '')}`,
              value: typeof entry.value === 'number' ? entry.value : Number(entry.value),
            };
          }
          return {
            id: `${name}-${index}-${String(entry)}`,
            value: typeof entry === 'number' ? entry : Number(entry),
          };
        }).filter((item) => Number.isFinite(item.value));

        result.push({ name, items: normalized });
      }
    }
    return result;
  }, [variables]);

  const getNumVar = useCallback((name) => {
    const v = variables?.[name];
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (typeof v?.value === 'number') return v.value;
    return null;
  }, [variables]);

  const iValue = getNumVar('i');
  const sumValue = getNumVar('sum');
  const currentValue = getNumVar('currentValue');

  const [renderedArrays, setRenderedArrays] = useState({});
  const [animByArray, setAnimByArray] = useState({});
  const swapTimersRef = useRef([]);
  const swapInFlightRef = useRef(false);

  useEffect(() => {
    setRenderedArrays((previous) => {
      const next = {};
      for (const arr of arrays) {
        // Keep a stable render order (do NOT reorder on swaps). Positions are animated separately.
        const prevItems = previous[arr.name] || [];
        const prevOrder = prevItems.map((item) => item.id);
        const incomingById = new Map(arr.items.map((item) => [item.id, item]));

        const merged = [];
        for (const id of prevOrder) {
          const incoming = incomingById.get(id);
          if (incoming) merged.push({ id, value: incoming.value });
        }
        for (const item of arr.items) {
          if (!prevOrder.includes(item.id)) merged.push({ id: item.id, value: item.value });
        }

        next[arr.name] = merged;
      }
      return next;
    });
  }, [arrays]);

  // Initialize/sync slot positions for any newly-seen ids.
  useEffect(() => {
    setAnimByArray((previous) => {
      const next = { ...previous };

      for (const arr of arrays) {
        const desiredOrder = arr.items.map((item) => item.id);
        const prevEntry = next[arr.name] || { positions: {}, lifts: {} };
        const positions = { ...(prevEntry.positions || {}) };
        const lifts = { ...(prevEntry.lifts || {}) };

        // Ensure each id has a position.
        desiredOrder.forEach((id, idx) => {
          if (typeof positions[id] !== 'number') positions[id] = idx;
        });

        // If no swap is in-flight, hard sync any drift to match the current array order.
        if (!swapInFlightRef.current) {
          desiredOrder.forEach((id, idx) => {
            positions[id] = idx;
          });
        }

        next[arr.name] = { positions, lifts };
      }

      return next;
    });
  }, [arrays]);

  // Stage swap animation: lift (one up / one down) -> slide into swapped slots -> settle.
  useEffect(() => {
    if (!currentFrame || currentFrame.eventType !== 'SWAP') return;

    const payload = currentFrame?.action?.payload;
    const arrayName = payload?.arrayName;
    const swapIndices = payload?.swapIndices;
    const before = payload?.before;

    if (!arrayName || !Array.isArray(swapIndices) || swapIndices.length !== 2 || !Array.isArray(before)) return;
    const [aIndex, bIndex] = swapIndices;
    const left = before?.[aIndex];
    const right = before?.[bIndex];
    const leftId = left?.id;
    const rightId = right?.id;
    if (!leftId || !rightId) return;

    // Clear any previously scheduled swap timers.
    swapTimersRef.current.forEach((timerId) => clearTimeout(timerId));
    swapTimersRef.current = [];
    swapInFlightRef.current = true;

    const liftMs = 220;
    const slideMs = 420;

    // Stage 1: lift/dip
    setAnimByArray((previous) => {
      const entry = previous[arrayName] || { positions: {}, lifts: {} };
      const positions = { ...(entry.positions || {}) };
      const lifts = { ...(entry.lifts || {}) };

      // Ensure they start at the pre-swap slots.
      positions[leftId] = aIndex;
      positions[rightId] = bIndex;

      lifts[leftId] = +1;
      lifts[rightId] = -1;

      return { ...previous, [arrayName]: { positions, lifts } };
    });

    // Stage 2: slide into each other's slots (while lifted)
    swapTimersRef.current.push(setTimeout(() => {
      setAnimByArray((previous) => {
        const entry = previous[arrayName] || { positions: {}, lifts: {} };
        const positions = { ...(entry.positions || {}) };
        const lifts = { ...(entry.lifts || {}) };

        positions[leftId] = bIndex;
        positions[rightId] = aIndex;

        return { ...previous, [arrayName]: { positions, lifts } };
      });
    }, liftMs));

    // Stage 3: settle
    swapTimersRef.current.push(setTimeout(() => {
      setAnimByArray((previous) => {
        const entry = previous[arrayName] || { positions: {}, lifts: {} };
        const positions = { ...(entry.positions || {}) };
        const lifts = { ...(entry.lifts || {}) };

        delete lifts[leftId];
        delete lifts[rightId];

        swapInFlightRef.current = false;
        return { ...previous, [arrayName]: { positions, lifts } };
      });
    }, liftMs + slideMs));

    return () => {
      swapTimersRef.current.forEach((timerId) => clearTimeout(timerId));
      swapTimersRef.current = [];
      swapInFlightRef.current = false;
    };
  }, [currentFrame]);

  const swapIndicesFromAction = currentFrame?.eventType === 'SWAP'
    ? (currentFrame?.action?.payload?.swapIndices || null)
    : null;

  return (
    <group>
      {arrays.map((arr, ai) => (
        <group key={arr.name} position={[0, ai * -3, 0]}>
          {/* Array name label */}
          <Text position={[-4.5, 0.6, 0]} fontSize={0.3} color={PALETTE.primary} anchorX="left">
            {arr.name}[ ]
          </Text>

          {(() => {
            const entry = animByArray[arr.name] || { positions: {}, lifts: {} };
            const positions = entry.positions || {};
            const lifts = entry.lifts || {};

            const itemsToRender = renderedArrays[arr.name] || arr.items;

            // Highlight the item currently at slot i (based on animated slot positions).
            const highlightSlot = Number.isInteger(iValue)
              ? Math.max(0, Math.min(arr.items.length - 1, iValue))
              : null;
            const highlightId = Number.isInteger(highlightSlot)
              ? itemsToRender.find((it) => positions[it.id] === highlightSlot)?.id
              : null;

            return itemsToRender.map((item, fallbackIndex) => {
              const slotIndex = Number.isFinite(positions[item.id]) ? positions[item.id] : fallbackIndex;
              const liftDir = Number.isFinite(lifts[item.id]) ? lifts[item.id] : 0;

              const liftedBySwapIndices = Boolean(
                currentFrame?.eventType === 'SWAP'
                && currentFrame?.action?.payload?.arrayName === arr.name
                && Array.isArray(swapIndicesFromAction)
                && swapIndicesFromAction.includes(slotIndex)
              );

              return (
                <ArrayCoach
                  key={item.id}
                  slotIndex={slotIndex}
                  value={item.value}
                  color={DS_COLORS.ARRAY.base}
                  liftDir={liftDir || (liftedBySwapIndices ? 1 : 0)}
                  highlight={
                    highlightId
                      ? item.id === highlightId
                      : (currentLine != null && arr.items.length > 0 && slotIndex === (currentLine % arr.items.length))
                  }
                />
              );
            });
          })()}

          {/* Sum ball for summation loops: moves with i and shows running sum */}
          {Number.isInteger(iValue) && typeof sumValue === 'number' && arr.items.length > 0 && (
            <group position={[
              Math.max(0, Math.min(arr.items.length - 1, iValue)) * 1.8 - 4,
              1.55,
              0
            ]}>
              <mesh>
                <sphereGeometry args={[0.28, 20, 20]} />
                <meshStandardMaterial
                  color={PALETTE.accent}
                  emissive={PALETTE.accent}
                  emissiveIntensity={1.1}
                  roughness={0.12}
                  metalness={0.45}
                />
              </mesh>
              <Text position={[0, 0.58, 0]} fontSize={0.2} color={PALETTE.accent} anchorX="center">
                SUM: {sumValue}
              </Text>
              {typeof currentValue === 'number' && (
                <Text position={[0, -0.52, 0]} fontSize={0.16} color={PALETTE.warning} anchorX="center">
                  +{currentValue}
                </Text>
              )}
              <Sparkles count={IS_DEV ? 5 : 12} scale={1.6} size={2} speed={0.35} color={PALETTE.accent} />
            </group>
          )}
          {/* Track rail */}
          <mesh position={[0, -0.65, 0]}>
            <boxGeometry args={[arr.items.length * 1.8 + 0.5, 0.06, 0.12]} />
            <meshStandardMaterial color="#444" metalness={0.8} roughness={0.3} />
          </mesh>

          {/* Final result highlight for sum programs */}
          {typeof sumValue === 'number' && Number.isInteger(iValue) && iValue >= arr.items.length && (
            <Billboard position={[arr.items.length * 0.95 - 3.9, 1.9, 0]}>
              <Text fontSize={0.26} color={PALETTE.accent} anchorX="center" outlineColor={PALETTE.accent} outlineWidth={0.012}>
                FINAL SUM = {sumValue}
              </Text>
            </Billboard>
          )}
        </group>
      ))}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LINKED LIST — chained capsules with glowing connector orbs
// ─────────────────────────────────────────────────────────────────────────────

function LinkedListNode({ position, value, nextPos, isHead, isTail, color = DS_COLORS.LINKED_LIST.base, highlight }) {
  const groupRef = useRef();

  useFrame(({ clock }) => {
    if (groupRef.current && highlight) {
      groupRef.current.position.y = position[1] + Math.sin(clock.elapsedTime * 5) * 0.1;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* Node capsule */}
      <mesh rotation={[0, 0, Math.PI/2]}>
        <capsuleGeometry args={[0.38, 0.8, 6, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={highlight ? 1.2 : 0.4}
          roughness={0.15}
          metalness={0.5}
          transparent
          opacity={0.92}
        />
      </mesh>

      {/* Value */}
      <Text position={[0, 0, 0.42]} fontSize={0.3} color="white" anchorX="center" outlineColor={color} outlineWidth={0.015}>
        {String(value ?? '?')}
      </Text>

      {/* HEAD / TAIL badge */}
      {(isHead || isTail) && (
        <Billboard position={[0, 0.7, 0]}>
          <Text fontSize={0.2} color={PALETTE.gold}>
            {isHead ? 'HEAD' : 'TAIL'}
          </Text>
        </Billboard>
      )}

      {/* Arrow connector to next */}
      {nextPos && (
        <PointerOrb
          from={[position[0] + 0.7, position[1], position[2]]}
          to={[nextPos[0] - 0.7, nextPos[1], nextPos[2]]}
          color={color}
          isNull={false}
        />
      )}

      {/* NULL terminator */}
      {!nextPos && (
        <group position={[1.4, 0, 0]}>
          <Text fontSize={0.22} color="#555" anchorX="center">NULL</Text>
          <mesh>
            <boxGeometry args={[0.6, 0.6, 0.1]} />
            <meshBasicMaterial color="#333" wireframe />
          </mesh>
        </group>
      )}

      {highlight && <Sparkles count={IS_DEV ? 4 : 8} scale={1.4} size={2} speed={0.4} color={color} />}
    </group>
  );
}

function LinkedListVisualizer({ variables }) {
  const nodes = useMemo(() => {
    // Extract linked list nodes from variables
    const nodeList = [];
    let idx = 0;
    for (const [name, data] of Object.entries(variables || {})) {
      if (data.type === 'struct' || data.type === 'pointer') {
        nodeList.push({ name, value: data.value ?? name, idx });
        idx++;
      }
    }
    if (nodeList.length === 0) {
      nodeList.push({ name: 'head', value: '1', idx: 0 });
      nodeList.push({ name: 'next', value: '2', idx: 1 });
      nodeList.push({ name: 'tail', value: '3', idx: 2 });
    }
    return nodeList;
  }, [variables]);

  return (
    <group>
      {nodes.map((node, i) => (
        <LinkedListNode
          key={node.name}
          position={[i * 2.6 - (nodes.length - 1) * 1.3, 0, 0]}
          value={node.value}
          nextPos={i < nodes.length - 1 ? [(i + 1) * 2.6 - (nodes.length - 1) * 1.3, 0, 0] : null}
          isHead={i === 0}
          isTail={i === nodes.length - 1}
          color={DS_COLORS.LINKED_LIST.base}
          highlight={false}
        />
      ))}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BINARY TREE — organic 3D tree with glowing sphere nodes
// ─────────────────────────────────────────────────────────────────────────────

function TreeNode({ position, value, depth, color = DS_COLORS.BINARY_TREE.base, highlight, parentPos }) {
  const meshRef = useRef();
  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    meshRef.current.material.emissiveIntensity = 0.4 + Math.sin(clock.elapsedTime * 2 + depth) * 0.15;
    if (highlight) meshRef.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 6) * 0.08);
  });

  const radius = Math.max(0.5 - depth * 0.05, 0.3);

  return (
    <group>
      {/* Edge to parent */}
      {parentPos && (
        <Line
          points={[parentPos, position]}
          color={color}
          lineWidth={2.5}
          transparent
          opacity={0.6}
        />
      )}

      {/* Node sphere */}
      <mesh ref={meshRef} position={position}>
        <sphereGeometry args={[radius, 20, 20]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.4}
          roughness={0.1}
          metalness={0.5}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* Value label */}
      <Billboard position={[position[0], position[1] + 0.08, position[2] + radius + 0.05]}>
        <Text fontSize={0.28} color="white" anchorX="center" outlineColor={color} outlineWidth={0.015}>
          {String(value)}
        </Text>
      </Billboard>

      {highlight && (
        <group position={position}>
          <Sparkles count={IS_DEV ? 6 : 12} scale={radius * 3} size={3} speed={0.5} color={color} />
        </group>
      )}
    </group>
  );
}

function BinaryTreeVisualizer({ variables }) {
  // Build a sample tree from variables or use a demo tree
  const treeData = useMemo(() => {
    const nodes = [];
    // Try to extract tree node values from variables
    let nodeVals = [];
    for (const [name, data] of Object.entries(variables || {})) {
      if (typeof data.value === 'number') nodeVals.push(data.value);
    }
    if (nodeVals.length === 0) nodeVals = [10, 5, 15, 3, 7, 12, 18];

    // Build balanced tree positions
    const build = (vals, index, depth, x, y, spread) => {
      if (index >= vals.length) return;
      nodes.push({ value: vals[index], position: [x, y, depth * -0.5], depth });
      build(vals, 2*index+1, depth+1, x - spread, y - 2.2, spread*0.55);
      build(vals, 2*index+2, depth+1, x + spread, y - 2.2, spread*0.55);
    };
    build(nodeVals, 0, 0, 0, 3, 3.5);
    return nodes;
  }, [variables]);

  return (
    <group>
      {treeData.map((node, i) => {
        const parentIdx = i === 0 ? null : Math.floor((i - 1) / 2);
        return (
          <TreeNode
            key={i}
            position={node.position}
            value={node.value}
            depth={node.depth}
            color={DS_COLORS.BINARY_TREE.base}
            highlight={false}
            parentPos={parentIdx !== null ? treeData[parentIdx]?.position : null}
          />
        );
      })}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GRAPH — force-directed 3D nodes with glowing edges
// ─────────────────────────────────────────────────────────────────────────────

function GraphNode({ position, label, color = DS_COLORS.GRAPH.base, highlight }) {
  const meshRef = useRef();
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    meshRef.current.material.emissiveIntensity = 0.5 + Math.sin(clock.elapsedTime * 2 + label.charCodeAt(0)) * 0.2;
  });

  return (
    <Float speed={1.5} rotationIntensity={0.1} floatIntensity={0.3}>
      <group position={position}>
        <mesh
          ref={meshRef}
          onPointerOver={() => setHovered(true)}
          onPointerOut={() => setHovered(false)}
          scale={hovered ? 1.2 : 1}
        >
          <icosahedronGeometry args={[0.4, 1]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} roughness={0.1} metalness={0.6} />
        </mesh>
        <Billboard>
          <Text fontSize={0.28} color="white" anchorX="center" outlineColor={color} outlineWidth={0.02}>
            {label}
          </Text>
        </Billboard>
        {highlight && <Sparkles count={IS_DEV ? 4 : 10} scale={1.5} size={3} speed={0.4} color={color} />}
      </group>
    </Float>
  );
}

function GraphVisualizer({ variables }) {
  // Demo graph (in real usage, parse from variables/classification metadata)
  const nodes = useMemo(() => [
    { label: 'A', pos: [0, 2, 0] },
    { label: 'B', pos: [-3, 0, 1] },
    { label: 'C', pos: [3, 0, 1] },
    { label: 'D', pos: [-2, -2.5, -1] },
    { label: 'E', pos: [2, -2.5, -1] },
    { label: 'F', pos: [0, -1, 2] },
  ], []);

  const edges = [[0,1],[0,2],[1,3],[2,4],[3,4],[1,5],[2,5]];

  return (
    <group>
      {edges.map(([a, b], i) => (
        <QuadraticBezierLine
          key={i}
          start={nodes[a].pos}
          end={nodes[b].pos}
          mid={[
            (nodes[a].pos[0]+nodes[b].pos[0])/2 + (Math.random()-0.5)*0.5,
            (nodes[a].pos[1]+nodes[b].pos[1])/2 + 0.5,
            (nodes[a].pos[2]+nodes[b].pos[2])/2,
          ]}
          color={DS_COLORS.GRAPH.base}
          lineWidth={2}
          transparent
          opacity={0.55}
        />
      ))}
      {nodes.map((node, i) => (
        <GraphNode key={i} position={node.pos} label={node.label} color={DS_COLORS.GRAPH.base} />
      ))}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STACK — plate stack visualizer
// ─────────────────────────────────────────────────────────────────────────────

function StackVisualizer({ variables }) {
  const items = useMemo(() => {
    for (const [, data] of Object.entries(variables || {})) {
      if (data.isArray && Array.isArray(data.value)) return data.value;
    }
    return [1, 3, 5, 7, 9];
  }, [variables]);

  return (
    <group>
      {items.map((val, i) => (
        <group key={i} position={[0, i * 0.55 - 1.5, 0]}>
          <mesh>
            <cylinderGeometry args={[1.2 - i * 0.04, 1.2 - i * 0.04, 0.42, 24]} />
            <meshStandardMaterial
              color={DS_COLORS.STACK.base}
              emissive={DS_COLORS.STACK.base}
              emissiveIntensity={0.3 + i * 0.08}
              roughness={0.2}
              metalness={0.5}
            />
          </mesh>
          <Text position={[0, 0, 0.26]} fontSize={0.25} color="white" anchorX="center">
            {String(val)}
          </Text>
        </group>
      ))}
      {/* TOP label */}
      <Billboard position={[1.6, items.length * 0.55 - 1.5, 0]}>
        <Text fontSize={0.22} color={PALETTE.warning}>← TOP</Text>
      </Billboard>
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE — conveyor belt visualizer
// ─────────────────────────────────────────────────────────────────────────────

function QueueVisualizer({ variables }) {
  const items = useMemo(() => {
    for (const [, data] of Object.entries(variables || {})) {
      if (data.isArray && Array.isArray(data.value)) return data.value;
    }
    return [2, 4, 6, 8];
  }, [variables]);

  return (
    <group>
      {/* Belt */}
      <mesh position={[0, -0.55, 0]}>
        <boxGeometry args={[items.length * 2 + 1, 0.12, 1.2]} />
        <meshStandardMaterial color="#333" metalness={0.8} roughness={0.3} />
      </mesh>
      {items.map((val, i) => (
        <group key={i} position={[(i - (items.length-1)/2) * 2, 0, 0]}>
          <mesh>
            <boxGeometry args={[1.5, 0.6, 1]} />
            <meshStandardMaterial
              color={DS_COLORS.QUEUE.base}
              emissive={DS_COLORS.QUEUE.base}
              emissiveIntensity={0.4}
              roughness={0.15}
              metalness={0.4}
            />
          </mesh>
          <Text position={[0, 0, 0.51]} fontSize={0.26} color="white" anchorX="center">
            {String(val)}
          </Text>
        </group>
      ))}
      <Billboard position={[(-(items.length-1)/2) * 2 - 1.4, 0.4, 0]}>
        <Text fontSize={0.2} color={PALETTE.accent}>FRONT →</Text>
      </Billboard>
      <Billboard position={[((items.length-1)/2) * 2 + 1.4, 0.4, 0]}>
        <Text fontSize={0.2} color={PALETTE.secondary}>← REAR</Text>
      </Billboard>
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HASH TABLE — bucket grid visualizer
// ─────────────────────────────────────────────────────────────────────────────

function HashTableVisualizer({ variables }) {
  const buckets = useMemo(() => Array.from({ length: 8 }, (_, i) => ({
    index: i,
    key: null,
    value: null,
    occupied: Math.random() > 0.45,
  })), []);

  return (
    <group>
      {buckets.map((bucket, i) => {
        const x = (i % 4) * 2.2 - 3.3;
        const y = Math.floor(i / 4) * -2.2 + 1;
        return (
          <group key={i} position={[x, y, 0]}>
            <mesh>
              <boxGeometry args={[1.7, 0.9, 0.5]} />
              <meshStandardMaterial
                color={bucket.occupied ? DS_COLORS.HASH_TABLE.base : '#1a1a2e'}
                emissive={bucket.occupied ? DS_COLORS.HASH_TABLE.base : '#000'}
                emissiveIntensity={bucket.occupied ? 0.5 : 0}
                roughness={0.2}
                metalness={0.5}
                transparent
                opacity={bucket.occupied ? 0.9 : 0.5}
                wireframe={!bucket.occupied}
              />
            </mesh>
            <Text position={[0, 0, 0.28]} fontSize={bucket.occupied ? 0.26 : 0.18} color={bucket.occupied ? 'white' : '#555'} anchorX="center">
              {bucket.occupied ? `k:${i}→v:${i*7%13}` : `[${i}]`}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WATER JUG — glass jug with animated water fill + overflow physics
// ─────────────────────────────────────────────────────────────────────────────

function WaterJug({ position, capacity, current, label, overflowing = false }) {
  const waterRef = useRef();
  const fillRatio = Math.min(current / capacity, 1);

  useFrame(({ clock }) => {
    if (!waterRef.current) return;
    // Animate water surface with gentle sine wave
    waterRef.current.scale.y = fillRatio + Math.sin(clock.elapsedTime * 3) * 0.01;
    waterRef.current.position.y = -1 + fillRatio * 2 - 0.01;
    waterRef.current.material.emissiveIntensity = 0.3 + Math.sin(clock.elapsedTime * 2) * 0.1;
  });

  return (
    <group position={position}>
      {/* Glass jug body (wireframe outline) */}
      <mesh>
        <cylinderGeometry args={[0.9, 0.75, 4, 20, 1, true]} />
        <meshStandardMaterial color="#88ccff" transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>
      {/* Glass walls */}
      <mesh>
        <cylinderGeometry args={[0.92, 0.77, 4, 20, 1, false]} />
        <meshStandardMaterial color="#aaddff" transparent opacity={0.08} roughness={0.05} metalness={0.1} />
      </mesh>
      {/* Water fill */}
      <mesh ref={waterRef} position={[0, -1 + fillRatio * 2, 0]}>
        <cylinderGeometry args={[0.86, 0.72, fillRatio * 4 + 0.01, 20]} />
        <meshStandardMaterial
          color="#3b82f6"
          emissive="#1d4ed8"
          emissiveIntensity={0.3}
          transparent
          opacity={0.75}
          roughness={0.05}
          metalness={0.1}
        />
      </mesh>
      {/* Rim */}
      <mesh position={[0, 2, 0]}>
        <torusGeometry args={[0.9, 0.05, 8, 20]} />
        <meshStandardMaterial color="#aaddff" transparent opacity={0.5} />
      </mesh>
      {/* Labels */}
      <Billboard position={[0, -2.5, 0]}>
        <Text fontSize={0.26} color={PALETTE.info} anchorX="center">{label}</Text>
      </Billboard>
      <Billboard position={[1.2, -1 + fillRatio * 4, 0]}>
        <Text fontSize={0.2} color="white">{current}L / {capacity}L</Text>
      </Billboard>
      {/* Overflow particles */}
      <WaterParticles position={[0, 2, 0]} active={overflowing} />
      {overflowing && (
        <Billboard position={[0, 3, 0]}>
          <Text fontSize={0.28} color={PALETTE.danger}>💧 OVERFLOW!</Text>
        </Billboard>
      )}
    </group>
  );
}

function WaterJugVisualizer({ variables }) {
  const jugs = useMemo(() => {
    const j = [];
    for (const [name, data] of Object.entries(variables || {})) {
      if (typeof data.value === 'number' && data.value >= 0) {
        j.push({ name, current: data.value, capacity: Math.max(data.value + 2, 5) });
      }
    }
    if (j.length < 2) return [
      { name: 'Jug A', current: 3, capacity: 5 },
      { name: 'Jug B', current: 1, capacity: 3 },
    ];
    return j.slice(0, 3);
  }, [variables]);

  return (
    <group>
      {jugs.map((jug, i) => (
        <WaterJug
          key={jug.name}
          position={[(i - (jugs.length-1)/2) * 3.5, 0, 0]}
          capacity={jug.capacity}
          current={jug.current}
          label={jug.name}
          overflowing={jug.current >= jug.capacity}
        />
      ))}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HEAP — pyramid visualizer
// ─────────────────────────────────────────────────────────────────────────────

function HeapVisualizer({ variables }) {
  const data = useMemo(() => {
    for (const [, d] of Object.entries(variables || {})) {
      if (d.isArray && Array.isArray(d.value)) return d.value;
    }
    return [90, 70, 80, 40, 60, 50, 30];
  }, [variables]);

  const levels = useMemo(() => {
    const result = [];
    let i = 0, level = 0;
    while (i < data.length) {
      const count = Math.pow(2, level);
      result.push(data.slice(i, i + count));
      i += count;
      level++;
    }
    return result;
  }, [data]);

  return (
    <group>
      {levels.map((row, li) => (
        row.map((val, ri) => {
          const x = (ri - (row.length-1)/2) * (2.2 - li * 0.2);
          const y = (levels.length - 1 - li) * 1.8 - 2;
          return (
            <group key={`${li}-${ri}`}>
              {/* Edge to parent */}
              {li > 0 && (
                <Line
                  points={[[x, y, 0], [
                    ((Math.floor(ri/2)) - (levels[li-1].length-1)/2) * (2.2 - (li-1)*0.2),
                    (levels.length - li) * 1.8 - 2,
                    0
                  ]]}
                  color={DS_COLORS.HEAP.base}
                  lineWidth={2}
                  transparent
                  opacity={0.5}
                />
              )}
              <mesh position={[x, y, 0]}>
                <sphereGeometry args={[0.42, 16, 16]} />
                <meshStandardMaterial
                  color={DS_COLORS.HEAP.base}
                  emissive={DS_COLORS.HEAP.base}
                  emissiveIntensity={0.45 - li * 0.05}
                  roughness={0.2}
                  metalness={0.4}
                />
              </mesh>
              <Billboard position={[x, y, 0.45]}>
                <Text fontSize={0.24} color="white" anchorX="center">{String(val)}</Text>
              </Billboard>
            </group>
          );
        })
      ))}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIE — letter tree
// ─────────────────────────────────────────────────────────────────────────────

function TrieVisualizer() {
  const nodes = [
    { id: 0, char: '∅', pos: [0, 3, 0], parent: null },
    { id: 1, char: 'a', pos: [-3, 1.5, 0], parent: 0 },
    { id: 2, char: 'b', pos: [3, 1.5, 0], parent: 0 },
    { id: 3, char: 'p', pos: [-4.5, 0, 0.5], parent: 1 },
    { id: 4, char: 't', pos: [-1.5, 0, 0.5], parent: 1 },
    { id: 5, char: 'e', pos: [1.5, 0, 0.5], parent: 2 },
    { id: 6, char: 'l', pos: [4.5, 0, 0.5], parent: 2 },
    { id: 7, char: 'p', pos: [-5, -1.5, 0], parent: 3, isEnd: true },
    { id: 8, char: 'e', pos: [-4, -1.5, 0], parent: 3 },
    { id: 9, char: 'e', pos: [4, -1.5, 0], parent: 6, isEnd: true },
  ];

  return (
    <group>
      {nodes.map(node => (
        <group key={node.id}>
          {node.parent !== null && (
            <Line
              points={[nodes[node.parent].pos, node.pos]}
              color={DS_COLORS.TRIE.base}
              lineWidth={2}
              transparent opacity={0.5}
            />
          )}
          <mesh position={node.pos}>
            <sphereGeometry args={[0.38, 14, 14]} />
            <meshStandardMaterial
              color={node.isEnd ? PALETTE.gold : DS_COLORS.TRIE.base}
              emissive={node.isEnd ? PALETTE.gold : DS_COLORS.TRIE.base}
              emissiveIntensity={node.isEnd ? 1.0 : 0.4}
              roughness={0.15}
              metalness={0.5}
            />
          </mesh>
          <Billboard position={[node.pos[0], node.pos[1], node.pos[2] + 0.42]}>
            <Text fontSize={0.3} color="white" anchorX="center" outlineColor={DS_COLORS.TRIE.base} outlineWidth={0.015}>
              {node.char}
            </Text>
          </Billboard>
        </group>
      ))}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENE ENVIRONMENT — animated stars, ground plane, ambient lighting
// ─────────────────────────────────────────────────────────────────────────────

function SceneEnvironment() {
  return (
    <>
      <Stars radius={60} depth={40} count={IS_DEV ? 400 : 2500} factor={4} saturation={0.6} fade speed={IS_DEV ? 0.25 : 0.5} />
      <fog attach="fog" args={['#0a0614', 25, 70]} />
      <ambientLight intensity={0.15} color="#6644aa" />
      <directionalLight position={[10, 15, 8]} intensity={1.2} color="white" castShadow />
      <pointLight position={[-8, 6, -5]} intensity={IS_DEV ? 0.8 : 1.8} color="#a78bfa" distance={25} />
      <pointLight position={[8, 4, 5]} intensity={IS_DEV ? 0.7 : 1.4} color="#f472b6" distance={20} />
      <pointLight position={[0, -3, 8]} intensity={IS_DEV ? 0.6 : 1.0} color="#34d399" distance={18} />
      {/* Ground plane with lighter reflections for dev */}
      <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, -5, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <MeshReflectorMaterial
          blur={IS_DEV ? [30, 10] : [300, 100]}
          resolution={IS_DEV ? 128 : 512}
          mixBlur={IS_DEV ? 0.4 : 0.8}
          mixStrength={IS_DEV ? 3 : 30}
          roughness={1}
          depthScale={IS_DEV ? 0.2 : 1.2}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          color="#050510"
          metalness={IS_DEV ? 0.2 : 0.6}
        />
      </mesh>
      {/* Atmospheric glow rings */}
      <AtmosphericRings />
    </>
  );
}

function AtmosphericRings() {
  const ring1 = useRef(), ring2 = useRef(), ring3 = useRef();
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ring1.current) { ring1.current.rotation.z = t * 0.08; ring1.current.rotation.x = Math.sin(t*0.05)*0.3; }
    if (ring2.current) { ring2.current.rotation.z = -t * 0.12; ring2.current.rotation.y = Math.cos(t*0.04)*0.2; }
    if (ring3.current) { ring3.current.rotation.x = t * 0.06; }
  });
  return (
    <>
      <mesh ref={ring1} position={[0, 0, -8]}>
        <torusGeometry args={[12, 0.05, 6, 120]} />
        <meshBasicMaterial color="#6366f1" transparent opacity={0.1} />
      </mesh>
      <mesh ref={ring2} position={[0, 0, -6]}>
        <torusGeometry args={[16, 0.04, 6, 120]} />
        <meshBasicMaterial color="#a78bfa" transparent opacity={0.07} />
      </mesh>
      <mesh ref={ring3} position={[0, 0, -4]}>
        <torusGeometry args={[20, 0.03, 6, 120]} />
        <meshBasicMaterial color="#f472b6" transparent opacity={0.05} />
      </mesh>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// IDLE STATE — shown when no code is running
// ─────────────────────────────────────────────────────────────────────────────

function IdleScene() {
  const groupRef = useRef();
  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.elapsedTime * 0.12;
      groupRef.current.position.y = Math.sin(clock.elapsedTime * 0.5) * 0.3;
    }
  });

  return (
    <group ref={groupRef}>
      <Sparkles count={IS_DEV ? 30 : 120} scale={10} size={3} speed={0.4} color="#a78bfa" />
      {/* Central atom */}
      <mesh>
        <icosahedronGeometry args={[1.2, 2]} />
        <MeshDistortMaterial
          color="#6366f1"
          emissive="#818cf8"
          emissiveIntensity={0.8}
          speed={2}
          distort={0.35}
          radius={1}
          roughness={0.1}
          metalness={0.5}
        />
      </mesh>
      {/* Orbiting rings */}
      {[0, Math.PI/3, Math.PI*2/3].map((angle, i) => (
        <mesh key={i} rotation={[angle, angle * 0.5, angle]}>
          <torusGeometry args={[2.2 + i * 0.3, 0.06, 8, 60]} />
          <meshBasicMaterial color={[PALETTE.primary, PALETTE.secondary, PALETTE.accent][i]} transparent opacity={0.6} />
        </mesh>
      ))}
      <Billboard position={[0, 2.5, 0]}>
        <Text fontSize={0.4} color="white" anchorX="center" outlineColor="#a78bfa" outlineWidth={0.03}>
          Write C++ code →
        </Text>
      </Billboard>
      <Billboard position={[0, 1.9, 0]}>
        <Text fontSize={0.22} color="#aaa" anchorX="center">
          Press Compile & Debug to visualize
        </Text>
      </Billboard>
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMERA CONTROLLER — auto-positions based on data structure type
// ─────────────────────────────────────────────────────────────────────────────

function CameraController({ dataStructure }) {
  const { camera } = useThree();

  const cameraPresets = {
    ARRAY:        { pos: [0, 2, 12], target: [0, 0, 0] },
    LINKED_LIST:  { pos: [0, 2, 14], target: [0, 0, 0] },
    STACK:        { pos: [4, 2, 8],  target: [0, 0, 0] },
    QUEUE:        { pos: [0, 3, 12], target: [0, 0, 0] },
    BINARY_TREE:  { pos: [0, 1, 18], target: [0, 0, 0] },
    GRAPH:        { pos: [0, 2, 16], target: [0, 0, 0] },
    HASH_TABLE:   { pos: [0, 2, 12], target: [0, 0, 0] },
    TRIE:         { pos: [0, 0, 16], target: [0, 0, 0] },
    HEAP:         { pos: [0, 2, 16], target: [0, 0, 0] },
    WATER_JUG:    { pos: [0, 3, 14], target: [0, 1, 0] },
    DEFAULT:      { pos: [0, 3, 14], target: [0, 0, 0] },
  };

  const preset = cameraPresets[dataStructure] || cameraPresets.DEFAULT;

  useFrame(() => {
    camera.position.lerp(new THREE.Vector3(...preset.pos), 0.02);
  });

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HUD OVERLAY — 3D floating stats panel inside the canvas
// ─────────────────────────────────────────────────────────────────────────────

function HUDOverlay({ classification, currentFrame, frameCount }) {
  if (!classification) return null;
  const ds = classification.dataStructure || 'N/A';
  const algo = classification.algorithm || 'N/A';
  const col = DS_COLORS[ds]?.base || PALETTE.primary;

  return (
    <Billboard position={[-7, 5, 0]} follow={false}>
      <Html transform occlude={false} style={{ pointerEvents: 'none' }}>
        <div style={{
          background: 'rgba(10,6,30,0.82)',
          border: `1px solid ${col}55`,
          borderRadius: 10,
          padding: '10px 16px',
          minWidth: 200,
          fontFamily: 'monospace',
          color: '#fff',
          fontSize: 12,
          backdropFilter: 'blur(8px)',
          boxShadow: `0 0 20px ${col}33`,
        }}>
          <div style={{ color: col, fontWeight: 'bold', marginBottom: 6 }}>
            🤖 AI Classification
          </div>
          <div>Type: <span style={{ color: col }}>{ds}</span></div>
          <div>Algo: <span style={{ color: PALETTE.secondary }}>{algo}</span></div>
          {classification.complexity && (
            <>
              <div>Time: <span style={{ color: PALETTE.accent }}>{classification.complexity.time}</span></div>
              <div>Space: <span style={{ color: PALETTE.warning }}>{classification.complexity.space}</span></div>
            </>
          )}
          <div style={{ marginTop: 6, color: '#888' }}>
            Frames: {frameCount} | Line: {currentFrame?.line ?? '—'}
          </div>
        </div>
      </Html>
    </Billboard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PHYSICS-BASED ERROR SCENE — when runtime errors occur
// ─────────────────────────────────────────────────────────────────────────────

function ErrorPhysicsScene({ errors }) {
  const latestError = errors[errors.length - 1];
  if (!errors.length) return null;

  return (
    <Physics gravity={[0, -9.8, 0]}>
      {latestError && (
        <>
          <ErrorCharacter
            position={[0, 4, 0]}
            message={
              latestError.type === 'SEGFAULT' ? '💥 Segmentation Fault!' :
              latestError.type === 'OUT_OF_BOUNDS' ? '🚧 Out of Bounds!' :
              latestError.type === 'STACK_OVERFLOW' ? '📚 Stack Overflow!' :
              latestError.type === 'NULL_POINTER' ? '🕳️ Null Pointer!' :
              latestError.type === 'DIVISION_BY_ZERO' ? '∞ Division by Zero!' :
              latestError.type === 'OVERFLOW' ? '💧 Overflow!' :
              '💥 Runtime Error!'
            }
            type={latestError.type}
          />
          <ConfettiExplosion
            position={[0, 2, 0]}
            active={true}
            count={100}
          />
          <SparkBurst position={[0, 1, 0]} active={latestError.type === 'NULL_POINTER'} />
          <WaterParticles position={[0, 2, 0]} active={latestError.type === 'OVERFLOW'} />
          {/* Physics-based falling debug blocks */}
          {Array.from({ length: 6 }, (_, i) => (
            <RigidBody key={i} position={[
              (Math.random() - 0.5) * 6,
              4 + Math.random() * 3,
              (Math.random() - 0.5) * 4
            ]} colliders="cuboid">
              <mesh>
                <boxGeometry args={[0.5, 0.5, 0.5]} />
                <meshStandardMaterial
                  color={[PALETTE.danger, PALETTE.warning, PALETTE.primary][i % 3]}
                  emissive={[PALETTE.danger, PALETTE.warning, PALETTE.primary][i % 3]}
                  emissiveIntensity={0.8}
                />
              </mesh>
            </RigidBody>
          ))}
          <CuboidCollider position={[0, -5, 0]} args={[20, 0.1, 20]} />
        </>
      )}
    </Physics>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DYNAMIC SWITCH — renders correct visualizer per data structure
// ─────────────────────────────────────────────────────────────────────────────

function DataStructureSwitch({ classification, currentFrame, errors }) {
  const ds = classification?.dataStructure || 'ARRAY';
  const vars = currentFrame?.variables || {};
  const hasErrors = errors && errors.length > 0;

  return (
    <group>
      {hasErrors ? (
        <ErrorPhysicsScene errors={errors} />
      ) : (
        <>
          {ds === 'ARRAY'       && <ArrayVisualizer variables={vars} currentLine={currentFrame?.line} currentFrame={currentFrame} />}
          {ds === 'LINKED_LIST' && <LinkedListVisualizer variables={vars} />}
          {ds === 'BINARY_TREE' && <BinaryTreeVisualizer variables={vars} />}
          {ds === 'GRAPH'       && <GraphVisualizer variables={vars} />}
          {ds === 'STACK'       && <StackVisualizer variables={vars} />}
          {ds === 'QUEUE'       && <QueueVisualizer variables={vars} />}
          {ds === 'HASH_TABLE'  && <HashTableVisualizer variables={vars} />}
          {ds === 'TRIE'        && <TrieVisualizer />}
          {ds === 'HEAP'        && <HeapVisualizer variables={vars} />}
          {ds === 'WATER_JUG'   && <WaterJugVisualizer variables={vars} />}
          {ds === 'CUSTOM'      && <ArrayVisualizer variables={vars} currentLine={currentFrame?.line} currentFrame={currentFrame} />}
          {!classification      && <IdleScene />}
        </>
      )}

      {/* Pointer orbs for all pointer variables */}
      {Object.entries(vars).map(([name, data]) => {
        if (!data.isPointer || !data.address) return null;
        return (
          <PointerOrb
            key={name}
            from={[-2, -1, 0]}
            to={[Math.random() * 4 - 2, Math.random() * 2, 0]}
            color={PALETTE.gold}
            label={`${name}*`}
            isNull={data.value === null}
          />
        );
      })}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOADING FALLBACK
// ─────────────────────────────────────────────────────────────────────────────

function Loader3D() {
  const ref = useRef();
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.x = clock.elapsedTime * 1.2;
      ref.current.rotation.y = clock.elapsedTime * 0.8;
    }
  });
  return (
    <mesh ref={ref}>
      <octahedronGeometry args={[0.8, 0]} />
      <meshStandardMaterial color={PALETTE.primary} emissive={PALETTE.primary} emissiveIntensity={1.2} wireframe />
    </mesh>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT: VisualizerEngine
// ─────────────────────────────────────────────────────────────────────────────

export function VisualizerEngine({
  currentFrame = null,
  allFrames = [],
  classification = null,
  errors = [],
  isDebugging = false,
  executionPlan = null,
}) {
  const ds = classification?.dataStructure;
  const colScheme = DS_COLORS[ds] || DS_COLORS.CUSTOM;
  const activeAction = currentFrame?.action || executionPlan?.steps?.[0]?.action || null;
  const planLabel = executionPlan
    ? `${executionPlan.stepCount ?? executionPlan.steps?.length ?? 0} steps • ${Math.round((executionPlan.confidence || 0) * 100)}%`
    : null;

  return (
    <div style={{ width: '100%', height: '100%', background: '#050310', position: 'relative' }}>
      {/* Top info bar */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 18px',
        background: 'rgba(5,3,16,0.7)',
        backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${colScheme.base}44`,
        fontFamily: 'monospace', fontSize: 12, color: '#ccc',
      }}>
        <span style={{ color: colScheme.base, fontWeight: 'bold', fontSize: 14 }}>
          ⚡ 3D VISUALIZER
        </span>
        {classification && (
          <>
            <span style={{ color: colScheme.glow }}>
              {classification.dataStructure}
            </span>
            <span style={{ color: '#666' }}>|</span>
            <span style={{ color: PALETTE.secondary }}>
              {classification.algorithm}
            </span>
            {classification.complexity && (
              <>
                <span style={{ color: '#666' }}>|</span>
                <span style={{ color: PALETTE.accent }}>
                  T: {classification.complexity.time}
                </span>
                <span style={{ color: PALETTE.warning }}>
                  S: {classification.complexity.space}
                </span>
              </>
            )}
          </>
        )}
        {planLabel && (
          <span style={{ color: PALETTE.warning }}>
            {planLabel}
          </span>
        )}
        {activeAction && (
          <span style={{ color: PALETTE.accent }}>
            {activeAction.keyword} → {activeAction.motion}
          </span>
        )}
        {isDebugging && (
          <span style={{
            marginLeft: 'auto',
            color: PALETTE.accent,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: PALETTE.accent,
              display: 'inline-block',
              animation: 'pulse 1s infinite',
            }} />
            LIVE
          </span>
        )}
        {errors.length > 0 && (
          <span style={{ marginLeft: 'auto', color: PALETTE.danger, fontWeight: 'bold' }}>
            💥 {errors[errors.length - 1]?.type || 'ERROR'}
          </span>
        )}
      </div>

      {/* 3D Canvas */}
      <Canvas
        style={{ width: '100%', height: '100%' }}
        camera={{ position: [0, 3, 14], fov: 50, near: 0.1, far: 200 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        shadows
        dpr={[1, 2]}
      >
        <Suspense fallback={<Loader3D />}>
          <SceneEnvironment />
          <CameraController dataStructure={ds} />
          <OrbitControls
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            minDistance={3}
            maxDistance={50}
            dampingFactor={0.05}
            enableDamping
          />

          {/* Main visualizer switch */}
          {classification ? (
            <DataStructureSwitch
              classification={classification}
              currentFrame={currentFrame}
              errors={errors}
            />
          ) : (
            <IdleScene />
          )}

          {/* HUD overlay */}
          <HUDOverlay
            classification={classification}
            currentFrame={currentFrame}
            frameCount={allFrames.length}
          />

          {/* Camera shake on errors */}
          {errors.length > 0 && (
            <CameraShake intensity={0.4} maxYaw={0.04} maxPitch={0.04} maxRoll={0.04} />
          )}
        </Suspense>
      </Canvas>

      {/* Inline CSS for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

export default VisualizerEngine;