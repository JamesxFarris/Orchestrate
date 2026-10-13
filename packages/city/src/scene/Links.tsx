import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { CityLayout, Placement } from '../layout.ts';
import { ACTIVITY_COLOR, useCity, type TeamRole } from '../store.ts';

/** Who an active agent is exchanging work with right now. */
function partnerOf(role: TeamRole, roles: TeamRole[]): TeamRole | undefined {
  const inSquad = (kind: string) => roles.find((r) => r.squad === role.squad && r.kind === kind);
  const master = roles.find((r) => r.kind === 'master');
  switch (role.kind) {
    case 'qa':
      return inSquad('dev') ?? inSquad('lead'); // tests hand over to the implementer
    case 'dev':
    case 'analyst':
      return inSquad('lead'); // diffs and specs go up for review
    case 'lead':
    case 'architect':
    case 'qa_head':
      return master;
    default:
      return undefined;
  }
}

function arc(a: Placement, b: Placement): THREE.Vector3[] {
  const from = new THREE.Vector3(a.x, a.archetype.top * 0.82, a.z);
  const to = new THREE.Vector3(b.x, b.archetype.top * 0.82, b.z);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  mid.y = Math.max(from.y, to.y) + from.distanceTo(to) * 0.22;
  return new THREE.QuadraticBezierCurve3(from, mid, to).getPoints(40);
}

/** A dashed line whose dashes flow from sender to receiver, like packets on a wire. */
function FlowLine({ points, color }: { points: THREE.Vector3[]; color: string }) {
  const ref = useRef<{ material: { dashOffset: number } }>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.material.dashOffset -= dt * 2.2;
  });
  return (
    <Line
      ref={ref as never}
      points={points}
      color={color}
      lineWidth={2.6}
      dashed
      dashSize={1.1}
      gapSize={0.7}
      transparent
      opacity={0.9}
      toneMapped={false}
    />
  );
}

export function Links({ layout }: { layout: CityLayout }) {
  const agents = useCity((s) => s.agents);
  const roles = useCity((s) => s.team?.roles ?? []);

  const links = useMemo(() => {
    const out: { key: string; points: THREE.Vector3[]; color: string }[] = [];
    for (const a of Object.values(agents)) {
      if (a.activity === 'idle') continue;
      const role = roles.find((r) => r.id === a.agentId);
      const partner = role && partnerOf(role, roles);
      const from = layout.byId.get(a.agentId);
      const to = partner && layout.byId.get(partner.id);
      if (!from || !to) continue;
      out.push({ key: `${a.agentId}->${partner.id}`, points: arc(from, to), color: ACTIVITY_COLOR[a.activity] });
    }
    return out;
  }, [agents, roles, layout]);

  return (
    <>
      {links.map((l) => (
        <FlowLine key={l.key} points={l.points} color={l.color} />
      ))}
    </>
  );
}
